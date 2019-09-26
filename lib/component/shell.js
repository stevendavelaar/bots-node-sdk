'use strict';

const { ComponentInvocation } = require("./sdk");
const { CommonProvider } = require('../../common/provider');
const { EntityModel } = require("../entity/entityModel");


/**
 * Component invocation shell. Applies handlin and invocation methods to a registry.
 * @memberof module:Lib
 * @param {*} config 
 * @param {ComponentRegistry} registry
 * @private
 */
function ComponentShell(config, registry) {
  let logger = (config ? config.logger : null);
  if (!logger) {
    logger = CommonProvider.getLogger();
  }

  // Registry validation
  if (!(registry && registry.components)) {
    throw new Error('Invalid component registry');
  }

  return {
    /**
     * Returns an array of metadata for all components.
     * @private
     */
    getAllComponentMetadata: function () {
      const allComponents = [];
      if (registry.components) {
        for (var componentName in registry.components) {
          let metadata = registry.components[componentName].metadata();
          // if component is event handler, then auto-register event handlers in metadata
          if (metadata.eventHandler) {
            let events = Object.keys(registry.components[componentName]).filter(e => e!=='metadata');
            metadata.events = events;  
          }
          allComponents.push(metadata);
        }
      }
      var allMetadata = {
        version: ComponentInvocation.sdkVersion(),
        components: allComponents
      };
      logger.debug("Component service metadata:\n"+JSON.stringify(allMetadata));
      return allMetadata;
    },
    /**
     * Invokes the named component.
     *
     * componentName is the name of the component (as a string) [required].
     * requestBody is the body of the invocation request (as an object) [required].
     * sdkMixin is an object that will be mixed in with the SDK instance that is made
     *  available to the invoked component [optional].  This mixin allows environment
     *  specific functionality to be made available to component implementations,
     *  and the ability override or extend existing SDK functionality.
     *
     *  For example, if a component service is built in MCS custom code, the MCS
     *  custom code SDK can be passed as a property in sdkMixin, and then component
     *  implementations can check for its existence and use it as desired.
     *
     * callback is a standard error-first callback [required].
     *   On success, the data passed to the callback is the invocation response.
     *   On error, the following error names may be used:
     *     'unknownComponent'
     *     'badRequest'
     *   Component implementations may cause arbitrary errors to be propagated
     *   through.
     * @private
     */
    invokeComponentByName: function (componentName, requestBody, sdkMixin, callback) {
      // assert invocation callback
      if (typeof callback !== 'function') {
        throw new Error('Invocation callback is required');
      }

      // Resolve component
      const component = (registry.components ? registry.components[componentName] : null);
      if (!component) {
        logger.error('Unknown component: ' + componentName);
        let err = new Error('Unknown component ' + componentName);
        err.name = 'unknownComponent';
        callback(err);
        return;
      }

      // Build an SDK object for this invocation, applying mixin
      let sdk;
      try {
        sdk = Object.assign(new ComponentInvocation(requestBody), sdkMixin || {});
      } catch (err) {
        logger.error('Invocation construct error: ' + err.message);
        callback(err);
        return;
      }

      // Invoke component, check whether we need to invoke entity resolve event handlers,
      // or it is regular CC invocation
      try {
        if (component.metadata().eventHandler) {
          let entityStatus = sdk.variable("system.state."+requestBody.state+".entityResolutionStatus");
          if (entityStatus && entityStatus.event) {
            // set up entity model to be passed to event handlers
            let entity = sdk.variable(entityStatus.variableName);
            let entityModel = new EntityModel(entity, entityStatus, sdk, logger);
            let event = entityStatus.event;
            let eventName = event.name;
            if (component[eventName]) {
              logger.debug(`Invoking event handler ${eventName} with event: ${JSON.stringify(event)}`);
              // all event handlers must be async (returning a promise)
              component[eventName](entityStatus.event, entityModel, sdk).then (returnValue => {
                if (eventName.startsWith("should")) {
                  let shouldPrompt = returnValue==undefined ? true : returnValue;
                  entityStatus.promptForValue = shouldPrompt;
                  logger.debug(`${eventName} returned ${shouldPrompt}`);
                }   
                callback(null, sdk.response());
              });
            } else {
              logger.debug(`No handler found for event: ${eventName}`);
              if (eventName.startsWith("shouldPrompt")) {
                entityStatus.promptForValue = true;
                logger.debug(`Defaulting return value for missing ${eventName} to true`);
              }
              callback(null, sdk.response());
            }              
          } else {
            logger.debug("Cannot determine event handler to be called");
            callback(null, sdk.response());
          }
        } else {
        // for now we check if the error is the sdk (old way of using done(sdk)) to be backward compat
          component.invoke(sdk, (componentErr) => {
            if (!componentErr || componentErr === sdk) {
              callback(null, sdk.response());
            } else {
              callback(componentErr, null);
            }
          });
  
        }
      } catch (err) {
        logger.error('Invocation error: ' + err.message);
        callback(err);
      }
    }
  };
}

module.exports = ComponentShell;