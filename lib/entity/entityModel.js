'use strict';


/**
 * The Bots EntityModel is a class for querying, validating and changing a composite bag entity and its
 * entity resolution status. 
 * </p>
 * An EntityModel class instance can be instantiated using the constructor taking the entity being resolved,
 * and the entity resolution status as arguments
 * @memberof module:Lib
 */
class EntityModel {

  constructor(entity, entityStatus, sdk, logger) {
      this._entity = entity;
      this._entityStatus = entityStatus;
      this._sdk = sdk;
      this._logger = logger;
      this.initSystemEntityDisplayProperties();
  }

  entity() {
    return this._entity;
  }

  getItemValue(name) {
    return this._entity[name];
  }

  setItemValue(name, value) {
    this._entity[name] = value;
  }
  
  clearItemValue(name) {
    delete this._entity[name];
  }

  addValidationError(itemName, error) {
    this._entityStatus.validationErrors[itemName] = error;
  }  

  disambiguationValues(itemName) {
    return this._entityStatus.disambiguationValues[itemName] || [];
  }  

  clearDisambiguationValues(itemName) {
    delete this._entityStatus.disambiguationValues[itemName];
  }  

  userInput() {
    return this._entityStatus.userInput;
  }

  /**
   *  By leaving name argument unspecified, it is left to ResolveEntities component to determine next item to resolve
   * @param {*} name name of the next bag item the user should be prompted for
   */
  solicitInput(itemName) {
    this._logger.debug(`Solicit input for ${itemName}`);
    if (itemName) {
      this._entityStatus.resolvingField = itemName;
      // remove from skipped items if present
      this.unskipItem(itemName);
    } else {
      delete this._entityStatus.resolvingField;
    }
    this._sdk.keepTurn(true);
  }

  skipItem(name) {
    this._logger.debug(`Skip item ${name}`);
    this._entityStatus.skippedItems.push(name);
    //clear resolving field if set to item that is now being skipped
    if (name === this._entityStatus.resolvingField) {
      delete this._entityStatus.resolvingField;
    }
  }

  unskipItem(name) {
    this._logger.debug(`Unskip item ${name}`);
    this._entityStatus.skippedItems =  this._entityStatus.skippedItems.filter(item => item !== name);
  }

  candidateMessage() {
    return this._entityStatus.candidateMessage;
  }

    /**
   * Add the bot message created by ResolveEntities component to the CC response.
   * Note that this is a messagePayload object, not a simply string because it could
   * also be a card message or so
   */
  addCandidateMessage() {
    if (!this._sdk.response().messages) {
      this._sdk.response().messages = [];
    }
    this._logger.debug("Using candidate bot message");
    let response = {
      tenantId: this._sdk.request().message.tenantId,
      channelConversation: this._sdk.request().message.channelConversation
    };
    response.messagePayload = this._entityStatus.candidateMessage;
    this._sdk.response().messages.push(response);
    this._sdk.keepTurn(false);
  }

  itemsUpdated() {
    return this._entityStatus.updatedEntities.map(ent => ent.name);
  }

  itemsMatchedOutOfOrder() {
    return this._entityStatus.outOfOrderMatches.map(ent => ent.name);
  }

  initSystemEntityDisplayProperties() {
    this._systemEntityDisplayProperties = {
     "DATE": {"properties": ["date"], "function": (date => new Date(date))}
    ,"CURRENCY": {"properties": ["amount", "currency"]}  
    ,"NUMBER": {"properties": ["number"]}  
    ,"YES_NO": {"properties": ["yesno"]}  
    };  
  }

  setSystemEntityDisplayProperties(entityName, properties) {
    this._systemEntityDisplayProperties[entityName].properties=properties;
  }

  setSystemEntityDisplayFunction(entityName, displayFunction) {
    this._systemEntityDisplayProperties[entityName].function=displayFunction;
  }

  getDisplayValue(entityName, rawValue) {
    let props = this._systemEntityDisplayProperties[entityName];
    if (props) {
      if (props.hasOwnProperty("function")) {
        return props["function"](rawValue[props.properties[0]]);
      } else {
        return props.properties.map(p => rawValue[p]).join(" ");
      }
    } else {
      return rawValue;
    }
  }

  compositeBagItems() {
    let cbvar = this._entityStatus.variableName;
    return this._sdk.response().context.variables[cbvar].type.compositeBagItems;
  }

  displayValue(itemName) {
    let itemValue = this._entity[itemName];

    let items =  this.compositeBagItems();
    for (let item of items) {
      if (item.name==itemName) {
        itemValue =  item.entityName ? this.getDisplayValue(item.entityName, itemValue)   :  itemValue;
      }
    }
    return itemValue;
  }

  displayValues() {
    let itemValues = [];
    let items =  this.compositeBagItems();
    for (let item of items) {
      if (this._entity.hasOwnProperty(item.name)) {
        let rawValue = this._entity[item.name];
        let itemValue =  item.entityName ? this.getDisplayValue(item.entityName, rawValue)   :  rawValue;
        itemValues.push({name: item.name, value: itemValue});
      }
    }
    return itemValues;
  }

  queueEntities(itemName) {
    let disambiguationValues = this.disambiguationValues(itemName);
    for (let i = 0; i < disambiguationValues.length; i++) {
      // for the first entity we take the existing entity if present, otherwise we create
      // new entity 
      let ent = (i==0 && this._entity) ? this._entity : {entityName: this.entityName()};
      // check whether other items also have multiple disambigation values
      // if so, we populate each entity we queue with these values as well
      let cbvar = this._entityStatus.variableName;
      let items =  this._sdk.response().context.variables[cbvar].type.compositeBagItems;
      for (let item of items) {
        if ((this.disambiguationValues(item.name) || []).length>i) {
          ent[item.name] = this.disambiguationValues(item.name)[i];
        }
      }  
      this.queueEntity(ent);
    }
    // remove all the disambiguation values
    this._entityStatus.disambiguationValues = {};
    // set first entity as current entity and return it
    let ent =  this.peekEntityQueue();
    this.setCurrentEntity(ent);
    return ent;
  }

  queueEntity(entity) {
    this._entityStatus.entityQueue.push(entity);
  }

  entityQueue() {
    return this._entityStatus.entityQueue;
  }

  popEntityQueue() {
    if (this._entityStatus.entityQueue.length>0) {
      this._entityStatus.entityQueue.shift();
    }
  }

  peekEntityQueue() {
    if (this._entityStatus.entityQueue.length>0) {
      return this._entityStatus.entityQueue[0];
    }
    return null;
  }

  addResolvedEntity(entity) {
    this._entityStatus.resolvedEntities.push(entity);
    this.popEntityQueue();
  }

  resolvedEntities() {
    return this._entityStatus.resolvedEntities;
  }

  entityName() {
    let variable =  this._sdk.response().context.variables[this._entityStatus.variableName];
    return variable.type.name;
  }

  setCurrentEntity(newEntity) {
    this._entity = newEntity;
    delete this._entityStatus.resolvingField;
    let variable =  this._sdk.response().context.variables[this._entityStatus.variableName];
    variable.value = newEntity;
  }
 
}

module.exports = {EntityModel}