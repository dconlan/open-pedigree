import AbstractTerminology from 'pedigree/terminology/abstractTerminology';

var CTSSTerminology = Class.create( AbstractTerminology, {

    initialize: function($super, type, codeSystem, validIdRegex, searchCount, ctssBaseUrl, valueColumn, textColumn) {
        $super(type, codeSystem, validIdRegex, searchCount);
        this._ctssBaseUrl = ctssBaseUrl;
        this._valueColumn = valueColumn;
        this._textColumn = textColumn;
    },

    getLookupURL: function(id){
        return this._ctssBaseUrl + '?df=' + this._valueColumn + ',' + this._textColumn +'&sf=' + this._valueColumn + '&term=' + this.desanitizeID(id);
    },

    processLookupResponse: function(response){
        var parsed = JSON.parse(response.responseText);
        //console.log(stringifyObject(parsed));
        if (parsed.length > 3 && parsed[3] && parsed[3][0]){
            return parsed[3][0][1];
        }
        throw "Failed to find result in response";
    },

    getSearchURL: function(searchTerm){
        return this._ctssBaseUrl + '?df=' + this._valueColumn + ',' + this._textColumn +'&maxList=' + this.getSearchCount() + '&term=' + searchTerm;
    },
    processSearchResponse: function(response){
        if (response && response.responseText) {
            var parsed = JSON.parse(response.responseText);

            if (parsed.length > 3 && parsed[3]) {

                var result = [];
                for (var v of parsed[3]) {
                    result.push({'text': v[1], 'value': v[0]});
                }
                return result;
            }
        }
    }

});

export default CTSSTerminology;
