import DisorderTerm, {DisorderTermType} from "pedigree/terminology/disorderTerm";
import GeneTerm, {GeneTermType} from "pedigree/terminology/geneTerm";
import PhenotypeTerm, {PhenotypeTermType} from "pedigree/terminology/phenotypeTerm";
import AbstractTerm from "pedigree/terminology/abstractTerm";


var TermFactory = TermFactory || {};

TermFactory.createTerm = function(type, id, name, callWhenReady){
  if (type === DisorderTermType) {
      return new DisorderTerm(id, name, callWhenReady);
  }
  if (type == GeneTermType){
      return new GeneTerm(id, name, callWhenReady);
  }
    if (type == PhenotypeTermType){
        return new PhenotypeTerm(id, name, callWhenReady);
    }
    console.log("No explicit class for type '" + type + "'");
    return new AbstractTerm(type, id, name, callWhenReady);
};

