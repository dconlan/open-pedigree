
import AbstractTerm from "pedigree/terminology/abstractTerm";

export var DisorderTermType = 'disorder';

var DisorderTerm = Class.create(AbstractTerm, {

    initialize: function($super, id, name, callWhenReady) {
        $super(DisorderTermType, id, name, callWhenReady);
    },
});

export default DisorderTerm;
