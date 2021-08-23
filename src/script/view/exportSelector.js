import PedigreeExport from 'pedigree/model/export';
// import saveTextAs from 'vendor/filesaver/FileSaver';


// import {saveTextAs} from 'vendor/filesaver/FileSaver';
// var saveTextAs = FileSaver.saveTextAs;
// import {PedigreeExport} from 'pedigree/model/export';

/**
 * The UI Element for exporting pedigrees
 *
 * @class ExportSelector
 */

var ExportSelector = Class.create( {

  initialize: function() {
    var _this = this;

    var mainDiv = new Element('div', {'class': 'import-selector'});

    var _addTypeOption = function (checked, labelText, value) {
      var optionWrapper = new Element('tr');
      var input = new Element('input', {'type' : 'radio', 'value': value, 'name': 'export-type'});
      input.observe('click', _this.disableEnableOptions );
      if (checked) {
        input.checked = true;
      }
      var label = new Element('label', {'class': 'import-type-label'}).insert(input).insert(labelText);
      optionWrapper.insert(label.wrap('td'));
      return optionWrapper;
    };
    var typeListElement = new Element('table');
    typeListElement.insert(_addTypeOption(true,  'PED', 'ped'));
    typeListElement.insert(_addTypeOption(false,  'FHIR', 'fhir'));
    typeListElement.insert(_addTypeOption(false,  'GA4GH FHIR', 'GA4GH'));
    typeListElement.insert(_addTypeOption(false,  'SVG', 'svg'));
    typeListElement.insert(_addTypeOption(false,  'PDF', 'pdf'));

    var fileDownload = new Element('a', {'id': 'downloadLink', 'style': 'display:none'});
    mainDiv.insert(fileDownload);

    var promptType = new Element('div', {'class': 'import-section'}).update('Data format:');
    var dataSection2 = new Element('div', {'class': 'import-block'});
    dataSection2.insert(promptType).insert(typeListElement);
    mainDiv.insert(dataSection2);

    var _addConfigOption = function (checked, name, cssClass, labelText, value) {
      var optionWrapper = new Element('tr');
      var input = new Element('input', {'type' : 'radio', 'value': value, 'name': name });
      if (checked) {
        input.checked = true;
      }
      var label = new Element('label', {'class': cssClass}).insert(input).insert(labelText);
      optionWrapper.insert(label.wrap('td'));
      return optionWrapper;
    };

    var configListElementPED = new Element('table', {'id': 'pedOptions'});
    var label = new Element('label', {'class': 'export-config-header'}).insert('Which of the following fields should be used to generate person IDs?');
    configListElementPED.insert(label.wrap('td').wrap('tr'));
    configListElementPED.insert(_addConfigOption(true,  'ped-options', 'export-subconfig-label', 'External ID', 'external'));
    configListElementPED.insert(_addConfigOption(false, 'ped-options', 'export-subconfig-label', 'Name', 'name'));
    configListElementPED.insert(_addConfigOption(false, 'ped-options', 'export-subconfig-label', 'None, generate new numeric ID for everyone', 'newid'));

    var configListElementPrivacy = new Element('table', {"id": "privacyOptions", "style": 'display:none'});
    var privLabel = new Element('label', {'class': 'export-config-header'}).insert('Privacy export options:');
    configListElementPrivacy.insert(privLabel.wrap('td').wrap('tr'));
    configListElementPrivacy.insert(_addConfigOption(true,  "privacy-options", "export-subconfig-label", "All data", "all"));
    configListElementPrivacy.insert(_addConfigOption(false, "privacy-options", "export-subconfig-label", "Remove personal information (name and age)", "nopersonal"));
    configListElementPrivacy.insert(_addConfigOption(false, "privacy-options", "export-subconfig-label", "Remove personal information and free-form comments", "minimal"));

    var promptConfig = new Element('div', {'class': 'import-section'}).update('Options:');
    var dataSection3 = new Element('div', {'class': 'import-block'});
    dataSection3.insert(promptConfig).insert(configListElementPED).insert(configListElementPrivacy);
    mainDiv.insert(dataSection3);

    var buttons = new Element('div', {'class' : 'buttons import-block-bottom'});
    buttons.insert(new Element('input', {type: 'button', name : 'export', 'value': 'Export', 'class' : 'button', 'id': 'export_button'}).wrap('span', {'class' : 'buttonwrapper'}));
    buttons.insert(new Element('input', {type: 'button', name : 'cancel', 'value': 'Cancel', 'class' : 'button secondary'}).wrap('span', {'class' : 'buttonwrapper'}));
    mainDiv.insert(buttons);

    var cancelButton = buttons.down('input[name="cancel"]');
    cancelButton.observe('click', function(event) {
      _this.hide();
    });
    var exportButton = buttons.down('input[name="export"]');
    exportButton.observe('click', function(event) {
      _this._onExportStarted();
    });

    var closeShortcut = ['Esc'];
    this.dialog = new PhenoTips.widgets.ModalPopup(mainDiv, {close: {method : this.hide.bind(this), keys : closeShortcut}}, {extraClassName: 'pedigree-import-chooser', title: 'Pedigree export', displayCloseButton: true});
  },

  /*
     * Disables unapplicable options on input type selection
     */
  disableEnableOptions: function() {
    var exportType = $$('input:checked[type=radio][name="export-type"]')[0].value;

    var pedOptionsTable = $('pedOptions');
    var privacyOptionsTable = $('privacyOptions');

    if (exportType == 'ped') {
      pedOptionsTable.show();
      privacyOptionsTable.hide();
    } else {
      pedOptionsTable.hide();
      privacyOptionsTable.show();
    }
  },

  /**
     * Loads the template once it has been selected
     *
     * @param event
     * @param pictureBox
     * @private
     */
  _onExportStarted: function() {
    this.hide();

    var exportType = $$('input:checked[type=radio][name="export-type"]')[0].value;

    if (exportType == 'ped') {
      var idGenerationSetting = $$('input:checked[type=radio][name="ped-options"]')[0].value;
      var exportString = PedigreeExport.exportAsPED(editor.getGraph().DG, idGenerationSetting);
      var fileName = 'open-pedigree.ped';
      var mimeType = 'text/plain';
      saveTextAs(exportString, fileName);
    }
    else {
      var privacySetting = $$('input:checked[type=radio][name="privacy-options"]')[0].value;
      if (exportType == 'fhir') {
        var exportString = PedigreeExport.exportAsFHIR(editor.getGraph().DG, privacySetting);
        var fileName = 'open-pedigree-fhir.json';
        var mimeType = 'application/fhir+json';
        saveTextAs(exportString, fileName);
      }
      else if (exportType == 'GA4GH') {
        var exportString = PedigreeExport.exportAsGA4GH(editor.getGraph().DG, privacySetting);
        var fileName = 'open-pedigree-GA4GH-fhir.json';
        var mimeType = 'application/fhir+json';
        saveTextAs(exportString, fileName);
      }
      else if (exportType == 'svg') {
        var exportString = PedigreeExport.exportAsSVG(editor.getGraph().DG, privacySetting);
        var fileName = 'open-pedigree.svg';
        var mimeType = 'image/svg+xml';
        saveTextAs(exportString, fileName);
      }
      else if (exportType == 'pdf') {
        let pdf = PedigreeExport.exportAsPDF(editor.getGraph().DG, privacySetting);
      }
    }


  },

  /**
     * Displays the template selector
     *
     * @method show
     */
  show: function() {
    this.dialog.show();
  },

  /**
     * Removes the the template selector
     *
     * @method hide
     */
  hide: function() {
    this.dialog.closeDialog();
  }
});

export default ExportSelector;
