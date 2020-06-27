import TerminologyManager from "pedigree/terminology/terminologyManger";

var AbstractTerm = Class.create( {

    initialize: function(type, id, name, callWhenReady) {
        // user-defined terms
        this._type = type;
        var sanitizedId = TerminologyManager.sanitizeID(this._type, id);
        var desanitizedId = TerminologyManager.desanitizeID(this._type, id);
        if (name == null && !TerminologyManager.isValidID(type, desanitizedId)) {
            name = desanitizedId;
        }

        this._id  = sanitizedId;
        this._name   = name ? name : 'loading...';

        if (!name && callWhenReady) {
            this.load(callWhenReady);
        }
    },

    /*
     * Returns the type of the term, which is used when accessing the terminology manager.
     */
    getTermType : function(){
        return this._type;
    },
    /*
     * Returns the ID of the term
     */
    getID: function() {
        return this._id;
    },

    /*
       * Returns the name of the term
       */
    getName: function() {
        return this._name;
    },

    load: function(callWhenReady) {
        var queryURL = TerminologyManager.getLookupURL(this._type, this._id);
        var extraAjaxOptions = TerminologyManager.getLookupAjaxOptions(this._type, this._id);
        var baseAjaxOptions = {
            method: 'GET',
            requestHeaders: {
                'X-Requested-With': null,
                'X-Prototype-Version': null
            },
            onSuccess: this.onDataReady.bind(this),
            onError: this.onDataFail.bind(this),
            onComplete: callWhenReady ? callWhenReady : {}
        };
        //console.log("QueryURL: " + queryURL);
        new Ajax.Request(queryURL, {...baseAjaxOptions, ...extraAjaxOptions});
    },

    onDataReady : function(response) {
        try {
            var result = TerminologyManager.processLookupResponse(this._type, response);
            console.log('LOADED ' + this._type + ' term: id = ' + TerminologyManager.desanitizeID(this._type, this._id) + ', name = ' + result);
            this._name = result;
        } catch (err) {
            console.log('[LOAD ' + this._type + ' TERM] Error: ' +  err);
            this._name = LookupManager.desanitizeID(this._type, this._id);
        }
    },
    onDataFail : function(error) {
        console.log('[LOAD ' + this._type + ' TERM] Error: ' +  error);
        console.log("Failed to load " + this._type + " term: id = '" + TerminologyManager.desanitizeID(this._type, this._id) + "' setting name to ID");
        this._name = LookupManager.desanitizeID(this._type, this._id);
    }
});


export default AbstractTerm;
