import AbstractTerminology from "pedigree/terminology/abstractTerminology";

var TerminologyManager = TerminologyManager || {};

TerminologyManager.terminologyForType = {};

TerminologyManager.addTerminology = function(type, terminology){
    var old = TerminologyManager.terminologyForType[type];
    TerminologyManager.terminologyForType[type] = terminology;
    return old;
};

TerminologyManager.desanitizeID = function(type, id){
    return TerminologyManager.terminologyForType[type].desanitizeID(id);
};

TerminologyManager.sanitizeID = function(type, id){
    return TerminologyManager.terminologyForType[type].sanitizeID(id);
};

TerminologyManager.isValidID = function(type, id){
    if (TerminologyManager.terminologyForType.hasOwnProperty(type)){
        var terminology = TerminologyManager.terminologyForType[type];
        return terminology.isValidID(id);
    }
    console.log("Didin't find lookup for " + type);
    return true;
};

TerminologyManager.getLookupURL = function(type, id){
    return TerminologyManager.terminologyForType[type].getLookupURL(id);
};

TerminologyManager.getLookupAjaxOptions = function(type, id){
    return TerminologyManager.terminologyForType[type].getLookupAjaxOptions(id);
};

TerminologyManager.processLookupResponse = function(type, response){
    return TerminologyManager.terminologyForType[type].processLookupResponse(response);
};

TerminologyManager.getSearchAjaxOptions = function(type, searchTerm){
    return TerminologyManager.terminologyForType[type].getSearchAjaxOptions(searchTerm);
};

TerminologyManager.getSearchURL = function(type, searchTerm){
    return TerminologyManager.terminologyForType[type].getSearchURL(searchTerm);
};

TerminologyManager.processSearchResponse = function(type, response){
    return TerminologyManager.terminologyForType[type].processSearchResponse(response);
};


TerminologyManager.getCodeSystem = function(type){
    return TerminologyManager.terminologyForType[type].getCodeSystem();
};

TerminologyManager.hasType = function(type){
    return TerminologyManager.terminologyForType.hasOwnProperty(type);
};

export default TerminologyManager;