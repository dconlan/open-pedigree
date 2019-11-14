
import AbstractTerm from "pedigree/terminology/abstractTerm";

export var GeneTermType = 'gene';

var GeneTerm = Class.create(AbstractTerm, {

    initialize: function($super, id, name, callWhenReady) {
        $super(GeneTermType, id, name, callWhenReady);
    },
});

export default GeneTerm;