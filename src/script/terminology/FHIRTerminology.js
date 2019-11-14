import AbstractTerminology from 'pedigree/terminology/abstractTerminology';

var FHIRTerminology = Class.create( AbstractTerminology, {

    initialize: function($super, type, codeSystem, validIdRegex, searchCount, fhirBaseUrl, valueSet) {
        $super(type, codeSystem, validIdRegex, searchCount);
        this._fhirBaseUrl = fhirBaseUrl;
        this._valueSet     = valueSet;
    },

    getLookupURL: function(id){
        return this._fhirBaseUrl + 'CodeSystem/$lookup?_format=json&system=' + this.getCodeSystem() + '&code=' + this.desanitizeID(id);
    },

    processLookupResponse: function(response){
        var parsed = JSON.parse(response.responseText);
        //console.log(stringifyObject(parsed));
        if (parsed.parameter){
            for (var i = 0; i < parsed.parameter.length; i++){
                if (parsed.parameter[i].name == 'display'){
                    return parsed.parameter[i].valueString;
                }
            }
        }
        throw "Failed to find result in response";
    },

    getSearchURL: function(searchTerm){
        return this._fhirBaseUrl + 'ValueSet/$expand?_format=json&url=' + this._valueSet + "&count=" + this.getSearchCount() + "&filter=" + searchTerm;
    },
    processSearchResponse: function(response){
        if (response && response.responseText) {
            var parsed = JSON.parse(response.responseText);

            if (parsed.expansion && parsed.expansion.contains) {

                var result = [];
                for (var v of parsed.expansion.contains) {
                    result.push({'text': v.display, 'value': v.code});
                }
                return result;
            }
        }
    }

});

export default FHIRTerminology;