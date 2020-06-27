import TerminologyManager from "pedigree/terminology/terminologyManger";

var AbstractTerminology = Class.create( {

    initialize: function(type, codeSystem, validIdRegex, searchCount) {

        this._type      = type;
        this._codeSystem   = codeSystem;
        this._validIdRegex = validIdRegex;
        this._searchCount = searchCount || 20;
    },
    getType: function(){
        return this._type;
    },
    getCodeSystem: function(){
        return this._codeSystem;
    },
    isValidID: function(id){
        if (this._validIdRegex){
            return this._validIdRegex.test(id);
        }
        return true;
    },
    getSearchCount: function(){
        return this._searchCount;
    },
    getLookupURL: function(id){
        throw 'Unimplemented method - should be using subclass';
    },
    /** Subclasses should override this if a lookup requires special options, such as a POST */
    getLookupAjaxOptions: function(id){
        return {};
    },
    processLookupResponse: function(response){
        throw 'Unimplemented method - should be using subclass';
    },
    getSearchURL: function(searchTerm){
        throw 'Unimplemented method - should be using subclass';
    },
    /** Subclasses should override this if a lookup requires special options, such as a POST */
    getSearchAjaxOptions: function(searchTerm){
      return {};
    },
    processSearchResponse: function(response){
        throw 'Unimplemented method - should be using subclass';
    },
    desanitizeID : function(id){
        var temp = id;
        temp = temp.replace(/_C_/g, ":");
        temp = temp.replace(/_L_/g, "(");
        temp = temp.replace(/_J_/g, ")");
        temp = temp.replace(/_D_/g, ".");
        temp = temp.replace(/_S_/g, "/");
        temp = temp.replace(/__/g, " ");
        return temp;
    },
    sanitizeID : function(id){
        var temp = id;
        temp = temp.replace(/[:]/g, '_C_');
        temp = temp.replace(/[\(\[]/g, '_L_');
        temp = temp.replace(/[\)\]]/g, '_J_');
        temp = temp.replace(/[.]/g, '_D_');
        temp = temp.replace(/\//g, '_S_');
        temp = temp.replace(/[^a-zA-Z0-9,;_\-*]/g, '__');
        return temp;
    }
});

export default AbstractTerminology;