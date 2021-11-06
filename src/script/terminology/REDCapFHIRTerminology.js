import AbstractTerminology from 'pedigree/terminology/abstractTerminology';

/**
 * This terminology is used by the redcap plugin to bridge from redcap to an external FHIR server.
 * Both Lookup and Query web services use the same endpoint, but a type parameter is used to
 * specify which is being carried out.
 *
 * The redcap webservice expects a POST, passing the following parameters:
 *
 * Lookup
 * type -> 'lookup'
 * system -> code system to be looked up
 * code -> the id to lookup.
 *
 * Query
 * type -> 'query'
 * url -> valueset url
 * filter -> search term
 * count -> number of rows to return.
 *
 * The data returned will be the response from the fhir server.
 *
 * @type {klass}
 */
var REDCapFHIRTerminology = Class.create( AbstractTerminology, {

    initialize: function($super, type, codeSystem, validIdRegex, searchCount, queryUrl, valueSet,
                         lookupAjaxOptions = {}, searchAjaxOptions = {}) {
        $super(type, codeSystem, validIdRegex, searchCount);
        this._queryUrl = queryUrl;
        this._valueSet     = valueSet;
        this._lookupAjaxOptions = lookupAjaxOptions;
        this._searchAjaxOptions = searchAjaxOptions;
    },

    getLookupURL: function(id){
        return this._queryUrl;
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
        return this._queryUrl ;
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
    },
    getLookupAjaxOptions: function(id){
        return { ...this._lookupAjaxOptions,
            method: 'POST',
            contentType: 'application/x-www-form-urlencoded',
            parameters: {type: 'lookup', system: this.getCodeSystem(), code: this.desanitizeID(id)},
        };
    },
    getSearchAjaxOptions: function(search){
        return { ...this._searchAjaxOptions,
            method: 'POST',
            contentType: 'application/x-www-form-urlencoded',
            parameters: { type: 'query', url: this._valueSet, filter: search, count: this.getSearchCount() },
            processData: false
        };
    },

});

export default REDCapFHIRTerminology;
