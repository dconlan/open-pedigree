import TemplateSelector from 'pedigree/view/templateSelector';
import PedigreeExport from 'pedigree/model/export';
import QuestionnaireConverter from './model/QuestionnaireConverter';
// import URI from 'vendor/URI.js';

/**
 * SaveLoadEngine is responsible for automatic and manual save and load operations.
 *
 * @class SaveLoadEngine
 * @constructor
 */

function unescapeRestData (data) {
  // http://stackoverflow.com/questions/4480757/how-do-i-unescape-html-entities-in-js-change-lt-to
  var tempNode = document.createElement('div');
  tempNode.innerHTML = data.replace(/&amp;/, '&');
  return tempNode.innerText || tempNode.text || tempNode.textContent;
}

function getSelectorFromXML(responseXML, selectorName, attributeName, attributeValue) {
  if (responseXML.querySelector) {
    // modern browsers
    return responseXML.querySelector(selectorName + '[' + attributeName + '=\'' + attributeValue + '\']');
  } else {
    // IE7 && IE8 && some other older browsers
    // http://www.w3schools.com/XPath/xpath_syntax.asp
    // http://msdn.microsoft.com/en-us/library/ms757846%28v=vs.85%29.aspx
    var query = '//' + selectorName + '[@' + attributeName + '=\'' + attributeValue + '\']';
    try {
      return responseXML.selectSingleNode(query);
    } catch (e) {
      // Firefox v3.0-
      alert('your browser is unsupported');
      window.stop && window.stop();
      throw 'Unsupported browser';
    }
  }
}

function getSubSelectorTextFromXML(responseXML, selectorName, attributeName, attributeValue, subselectorName) {
  var selector = getSelectorFromXML(responseXML, selectorName, attributeName, attributeValue);

  var value = selector.innerText || selector.text || selector.textContent;

  if (!value) {    // fix IE behavior where (undefined || "" || undefined) == undefined
    value = '';
  }

  return value;
}

function getParameterByName(url, name) {
  name = name.replace(/[[\]]/g, '\\$&');
  var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
    results = regex.exec(url);
  if (!results) {
    return null;
  }
  if (!results[2]) {
    return '';
  }
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

var SaveLoadEngine = Class.create( {

  initialize: function() {
    this._saveInProgress = false;
    this._context = undefined;
  },

  /**
     * Saves the state of the graph
     *
     * @return Serialization data for the entire graph
     */
  serialize: function() {
    return editor.getGraph().toJSON();
  },

  createGraphFromSerializedData: function(JSONString, noUndo, centerAround0) {
    console.log('---- load: parsing data ----');
    document.fire('pedigree:load:start');

    try {
      var changeSet = editor.getGraph().fromJSON(JSONString);
    } catch(err) {
      console.log('ERROR loading the graph: ', err);
      alert('Error loading the graph');
      document.fire('pedigree:graph:clear');
      document.fire('pedigree:load:finish');
      return false;
    }

    // if (editor.getView().applyChanges(changeSet, false)) {
    //   editor.getWorkspace().adjustSizeToScreen();
    // }
    editor.getView().applyChanges(changeSet, false);
    editor.getWorkspace().adjustSizeToScreen();

    if (centerAround0) {
      editor.getWorkspace().centerAroundNode(0);
    }

    if (!noUndo) {
      editor.getActionStack().addState(null, null, JSONString);
    }

    document.fire('pedigree:load:finish');
    return true;
  },

  createGraphFromImportData: function(importString, importType, importOptions, noUndo, centerAround0) {
    console.log('---- import: parsing data ----');
    document.fire('pedigree:load:start');

    try {
      var changeSet = editor.getGraph().fromImport(importString, importType, importOptions);
      if (changeSet == null) {
        throw 'unable to create a pedigree from imported data';
      }
    } catch(err) {
      console.log('Error importing pedigree:');
      console.log(err);
      alert('Error importing pedigree: ' + err);
      document.fire('pedigree:load:finish');
      return false;
    }

    if (!noUndo) {
      var JSONString = editor.getGraph().toJSON();
    }

    if (editor.getView().applyChanges(changeSet, false)) {
      editor.getWorkspace().adjustSizeToScreen();
    }

    if (centerAround0) {
      editor.getWorkspace().centerAroundNode(0);
    }

    if (!noUndo) {
      editor.getActionStack().addState(null, null, JSONString);
    }

    document.fire('pedigree:load:finish');
    return true;
  },

  createGraphFromBaseGraph: function(baseGraph, noUndo, centerAround0) {
    document.fire('pedigree:load:start');

    try {
      var changeSet = editor.getGraph().fromBaseGraph(baseGraph);
      if (changeSet == null) {
        throw 'unable to create a pedigree from base graph';
      }
    } catch(err) {
      console.log('Error importing pedigree:');
      console.log(err);
      alert('Error importing pedigree: ' + err);
      document.fire('pedigree:load:finish');
      return false;
    }

    if (!noUndo) {
      var JSONString = editor.getGraph().toJSON();
    }

    if (editor.getView().applyChanges(changeSet, false)) {
      editor.getWorkspace().adjustSizeToScreen();
    }

    if (centerAround0) {
      editor.getWorkspace().centerAroundNode(0);
    }

    if (!noUndo) {
      editor.getActionStack().addState(null, null, JSONString);
    }

    document.fire('pedigree:load:finish');
    return true;
  },

  save: function(patientDataUrl) {
    let jsonData;
    if (this._saveInProgress) {
      return;
    }   // Don't send parallel save requests

    var me = this;


    if (patientDataUrl) {
      document.fire('pedigree:save:start');
      let pedigreeImage = PedigreeExport.exportAsSVG(editor.getGraph().DG);

      const uri = new URI(patientDataUrl);
      if (uri.protocol() === 'local' ) {
        const localStorageKey = uri.path();
        uri.normalizeQuery();
        const options = uri.search();
        const format = getParameterByName(options, 'format') || 'internal';
        const closeOnSave = getParameterByName(options, 'closeOnSave');
        const qDataKey = getParameterByName(options, 'qData');

        if (qDataKey){
          console.log('found qData key : ' + qDataKey );
          let oldQData = JSON.parse(localStorage.getItem(qDataKey));
          let qData = QuestionnaireConverter.createQuestionnaireDataFromGraph(editor.getGraph().DG, oldQData);
          localStorage.setItem(qDataKey, JSON.stringify(qData, null, 2));
          console.log('Set qData into local stoarge', qData);
        }

        jsonData = null;
        if (format === 'fhir'){
          // var patientFhirRef = (this._context) ? this._context.patientFhirRef : null;
          var patientFhirRef = null;
          jsonData = PedigreeExport.exportAsFHIR(editor.getGraph().DG, 'all', patientFhirRef, pedigreeImage);
        }
        // else if (this._saveAs === "simpleJSON"){
        //   jsonData = PedigreeExport.exportAsSimpleJSON(editor.getGraph().DG, "all");;
        // }
        else {
          jsonData = this.serialize();
        }
        const data = {};
        data.value = jsonData;
        if (this._context){
          data.context = this._context;
        }
        localStorage.setItem(localStorageKey, JSON.stringify(data, null, 2));

        console.log('[SAVE] to local storage : ' + localStorageKey + ' as ' + format);
        document.fire('pedigree:save:complete');
        if (closeOnSave === 'true' || closeOnSave === ''){
          console.log('Attempt to close the window');
          window.close();
        }
      } else {
        jsonData = this.serialize();

        console.log('[SAVE] data: ' + JSON.stringify(jsonData,null, 2));

        new Ajax.Request(patientDataUrl, {
          method: 'POST',
          onCreate: function() {
            me._saveInProgress = true;
          },
          onComplete: function() {
            me._saveInProgress = false;
            document.fire('pedigree:save:complete');
          },
          onSuccess: function() {},
          parameters: {'property#data': jsonData, 'property#image': pedigreeImage}
        });
      }
    }
  },

  load: function(patientDataUrl) {

    console.log('initiating load process');
    var _this = this;
    var didLoadData = false;
    if (patientDataUrl) {
      var uri = new URI(patientDataUrl);
      if (uri.protocol() === 'local' ){
        var localStorageKey = uri.path();
        uri.normalizeQuery();
        var options = uri.search();
        var format = getParameterByName(options, 'format') || 'internal';
        var qDataKey = getParameterByName(options, 'qData');
        var qData = undefined;

        if (qDataKey){
          console.log('found qData key : ' + qDataKey );
          qData = JSON.parse(localStorage.getItem(qDataKey));
        }

        console.log('initiating load process from local storage : ' + localStorageKey + ' as ' + format);

        var data = JSON.parse(localStorage.getItem(localStorageKey));
        var clear = true;
        var createCalled = false;
        if (data){
          if(data.context){
            this._context = data.context;
          } else {
            this._context = undefined;
          }

          var jsonData  = data.value;
          if (jsonData && jsonData.length > 0){
            createCalled = true;
            if (format === 'fhir') {
              if (this.createGraphFromImportData(jsonData, format, {}, false /* add to undo stack */, true /*center around 0*/)) {
                // loaded
                clear = false;
              }
            } else {
              jsonData = editor.getVersionUpdater().updateToCurrentVersion(jsonData);
              this.createGraphFromSerializedData(jsonData);
              // the createGraphFromSerializedData method will clear if it errors
              clear = false;
            }
          } else if (qData && qData.length > 0) {
            createCalled = true;
            var newBaseGraph = QuestionnaireConverter.initFromQuestionnaire(qData);
            if (this.createGraphFromBaseGraph(newBaseGraph, false /* add to undo stack */, true /*center around 0*/)){
              clear = false;
            }
          }
        } else if (qData && qData.length > 0) {
          createCalled = true;
          var newBaseGraph = QuestionnaireConverter.initFromQuestionnaire(qData);
          if (this.createGraphFromBaseGraph(newBaseGraph, false /* add to undo stack */, true /*center around 0*/)){
            clear = false;
          }
        }
        if (createCalled){
          if (clear){
            // empty
            new TemplateSelector(true);
          }
        } else {
          console.log('No data to load');
          console.log('Clearing graph');
          new TemplateSelector(true);
        }
      } else {
        new Ajax.Request(patientDataUrl, {
          method: 'GET',
          onCreate: function() {
            document.fire('pedigree:load:start');
          },
          onSuccess: function(response) {
            //console.log("Data from LOAD: " + JSON.stringify(response));
            //console.log("[Data from LOAD]");
            if (response && response.responseXML) {
              var rawdata  = getSubSelectorTextFromXML(response.responseXML, 'property', 'name', 'data', 'value');
              var jsonData = unescapeRestData(rawdata);
              if (jsonData.trim()) {
                console.log('[LOAD] recived JSON: ' + JSON.stringify(jsonData));

                jsonData = editor.getVersionUpdater().updateToCurrentVersion(jsonData);

                _this.createGraphFromSerializedData(jsonData);

                didLoadData = true;
              }
            }
          },
          onComplete: function() {
            if (!didLoadData) {
              // If load failed, just open templates
              new TemplateSelector(true);
            }
          }
        });
      }
    } else {
      new TemplateSelector(true);
    }
  }
});

export default SaveLoadEngine;
