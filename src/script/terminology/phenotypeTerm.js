
import AbstractTerm from "pedigree/terminology/abstractTerm";

export var PhenotypeTermType = 'phenotype';

var PhenotypeTerm = Class.create(AbstractTerm, {

    initialize: function($super, id, name, callWhenReady) {
        $super(PhenotypeTermType, id, name, callWhenReady);
    },
});

export default PhenotypeTerm;
