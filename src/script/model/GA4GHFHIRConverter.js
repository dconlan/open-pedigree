import BaseGraph from 'pedigree/model/baseGraph';
import RelationshipTracker from 'pedigree/model/relationshipTracker';
import TerminologyManager from 'pedigree/terminology/terminologyManger';
import {GeneTermType} from 'pedigree/terminology/geneTerm';
import {DisorderTermType} from 'pedigree/terminology/disorderTerm';
import {PhenotypeTermType} from 'pedigree/terminology/phenotypeTerm';
import FHIRConverter from './FHIRConverter';


var GA4GHFHIRConverter = function () {
};

GA4GHFHIRConverter.prototype = {};

/* ===============================================================================================
 *
 * Creates and returns a BaseGraph from a text string in the "FHIR JSON" format.
 *
 * We will support 2 different styles of fhir resource, a composition in the format used to export the
 * pedigree and a List of FamilyMemberHistory resources.
 * ===============================================================================================
 */


GA4GHFHIRConverter.initFromFHIR = function (inputText) {
  let inputResource = null;
  try {
    inputResource = JSON.parse(inputText);
  } catch (err) {
    throw 'Unable to import pedigree: input is not a valid JSON string '
    + err;
  }
  if ((inputResource.resourceType === 'Composition' || inputResource.resourceType === 'List')
       && (!inputResource.meta || !inputResource.meta.profile || !inputResource.meta.profile.includes('http://purl.org/ga4gh/pedigree-fhir-ig/StructureDefinition/Pedigree'))) {

    // not the right profile, try the old fhir importer
    return FHIRConverter.initFromFHIR(inputText);
  }
  else if (inputResource.resourceType === 'Composition' && inputResource.meta  && inputResource.meta.profile
    && inputResource.meta.profile.includes('http://purl.org/ga4gh/pedigree-fhir-ig/StructureDefinition/Pedigree')) {

    let twinTracker = {'nextTwinGroupId': 1, 'lookup': {}, 'groupIdLookup': {}};
    let containedResourcesLookup = {};
    let patientResources = [];
    let familyHistoryResources = [];
    let conditionResources = [];
    let observationResources = [];
    if (inputResource.contained) {
      let containedArr = inputResource.contained;
      for (let i = 0; i < containedArr.length; i++) {
        containedResourcesLookup['#' + containedArr[i].id] = containedArr[i];
        if (containedArr[i].resourceType === 'Patient') {
          patientResources.push(containedArr[i]);
        }
        if (containedArr[i].resourceType === 'FamilyMemberHistory') {
          familyHistoryResources.push(containedArr[i]);
        }
        if (containedArr[i].resourceType === 'Condition') {
          conditionResources.push(containedArr[i]);
        }
        if (containedArr[i].resourceType === 'Observation') {
          observationResources.push(containedArr[i]);
        }
      }
    }
    let subjectRef = inputResource.subject;
    let subjectResource = null;
    if (subjectRef && subjectRef.reference
      && subjectRef.reference[0] === '#') {
      // we have a contained patient
      subjectResource = containedResourcesLookup[subjectRef.reference];
    }
    let newG = new BaseGraph();

    let nameToID = {};
    let externalIDToID = {};
    let ambiguousReferences = {};
    let hasID = {};

    let nodeData = [];
    let nodeDataLookup = {};
    for (const patientResource of patientResources){
      const node = this.extractDataFromPatient(patientResource, containedResourcesLookup, twinTracker);
      node.nodeId = nodeData.size();
      nodeData.push(node);
      nodeDataLookup['#' + node.properties.id] = node;
    }

    for (const fmhResource of familyHistoryResources){
      this.extractDataFromFMH(fmhResource, nodeDataLookup, containedResourcesLookup, twinTracker);
    }

    for (const conditionResource of conditionResources){
      this.extractDataFromCondition(conditionResource, nodeDataLookup, containedResourcesLookup, twinTracker);
    }

    for (const observationResource of observationResources){
      this.extractDataFromObservation(observationResource, nodeDataLookup, containedResourcesLookup, twinTracker);
    }




    // first pass: add all vertices and assign vertex IDs
    for (const nextPerson of nodeData){
      // add twin groups
      if (nextPerson.nodeId in twinTracker.lookup){
        nextPerson.properties.twinGroup = twinTracker.lookup[nextPerson.nodeId];
      }

      let pedigreeID = newG._addVertex(null, BaseGraph.TYPE.PERSON, nextPerson.properties,
        newG.defaultPersonNodeWidth);

      if (nextPerson.properties.id) {
        if (externalIDToID.hasOwnProperty(nextPerson.properties.id)) {
          throw 'Unable to import pedigree: multiple persons with the same ID ['
          + nextPerson.properties.id + ']';
        }
        if (nameToID.hasOwnProperty(nextPerson.properties.id)
          && nameToID[nextPerson.properties.id] !== pedigreeID) {
          delete nameToID[nextPerson.properties.id];
          ambiguousReferences[nextPerson.properties.id] = true;
        } else {
          externalIDToID[nextPerson.properties.id] = pedigreeID;
          hasID[nextPerson.properties.id] = true;
        }
      }
      if (nextPerson.properties.fName) {
        if (nameToID.hasOwnProperty(nextPerson.properties.fName)
          && nameToID[nextPerson.properties.fName] !== pedigreeID) {
          // multiple nodes have this first name
          delete nameToID[nextPerson.properties.fName];
          ambiguousReferences[nextPerson.properties.fName] = true;
        } else if (externalIDToID.hasOwnProperty(nextPerson.properties.fName)
          && externalIDToID[nextPerson.properties.fName] !== pedigreeID) {
          // some other node has this name as an ID
          delete externalIDToID[nextPerson.properties.fName];
          ambiguousReferences[nextPerson.properties.fName] = true;
        } else {
          nameToID[nextPerson.properties.fName] = pedigreeID;
        }
      }
      // only use externalID if id is not present
      if (nextPerson.properties.hasOwnProperty('externalId')
        && !hasID.hasOwnProperty(pedigreeID)) {
        externalIDToID[nextPerson.properties.externalId] = pedigreeID;
        hasID[pedigreeID] = true;
      }

    }

    let getPersonID = function (person) {
      if (person.properties.hasOwnProperty('id')) {
        return externalIDToID[person.properties.id];
      }

      if (person.hasOwnProperty('fName')) {
        return nameToID[person.properties.fName];
      }
    };

    let findReferencedPerson = function (reference, refType) {
      if (ambiguousReferences.hasOwnProperty(reference)) {
        throw 'Unable to import pedigree: ambiguous reference to ['
        + reference + ']';
      }

      if (externalIDToID.hasOwnProperty(reference)) {
        return externalIDToID[reference];
      }

      if (nameToID.hasOwnProperty(reference)) {
        return nameToID[reference];
      }

      throw 'Unable to import pedigree: ['
      + reference
      + '] is not a valid '
      + refType
      + ' reference (does not correspond to a name or an ID of another person)';
    };

    let defaultEdgeWeight = 1;

    let relationshipTracker = new RelationshipTracker(newG,
      defaultEdgeWeight);

    // second pass (once all vertex IDs are known): process parents/children & add edges
    for (let i = 0; i < nodeData.length; i++) {
      let nextPerson = nodeData[i];

      let personID = getPersonID(nextPerson);

      let motherLink = nextPerson.hasOwnProperty('mother') ? nodeData[nextPerson['mother']].properties.id
        : null;
      let fatherLink = nextPerson.hasOwnProperty('father') ? nodeData[nextPerson['father']].properties.id
        : null;

      if (motherLink == null && fatherLink == null) {
        continue;
      }

      // create a virtual parent in case one of the parents is missing
      let fatherID = null;
      let motherID = null;
      if (fatherLink == null) {
        fatherID = newG._addVertex(null, BaseGraph.TYPE.PERSON, {
          'gender': 'M',
          'comments': 'unknown'
        }, newG.defaultPersonNodeWidth);
      } else {
        fatherID = findReferencedPerson(fatherLink, 'father');
        if (newG.properties[fatherID].gender === 'F') {
          throw 'Unable to import pedigree: a person declared as female is also declared as being a father ('
          + fatherLink + ')';
        }
      }
      if (motherLink == null) {
        motherID = newG._addVertex(null, BaseGraph.TYPE.PERSON, {
          'gender': 'F',
          'comments': 'unknown'
        }, newG.defaultPersonNodeWidth);
      } else {
        motherID = findReferencedPerson(motherLink, 'mother');
        if (newG.properties[motherID].gender === 'M') {
          throw 'Unable to import pedigree: a person declared as male is also declared as being a mother ('
          + motherLink + ')';
        }
      }

      if (fatherID === personID || motherID === personID) {
        throw 'Unable to import pedigree: a person is declared to be his or hew own parent';
      }

      // both motherID and fatherID are now given and represent valid existing nodes in the pedigree

      // if there is a relationship between motherID and fatherID the corresponding childhub is returned
      // if there is no relationship, a new one is created together with the chldhub
      let chhubID = relationshipTracker.createOrGetChildhub(motherID,
        fatherID);

      newG.addEdge(chhubID, personID, defaultEdgeWeight);
    }

    newG.validate();

    // set any
    for (const nextPerson of nodeData){
      if (nextPerson.cpartners){
        let nextPersonId = undefined;
        for (const partner of nextPerson.cpartners){
          if (partner < nextPerson.nodeId){
            continue; // should have already been processed.
          }
          if (nextPersonId === undefined){
            nextPersonId = findReferencedPerson(nextPerson.properties.id, 'cpartner');
          }
          const partnerId = findReferencedPerson(nodeData[partner].properties.id, 'cpartner');
          let relNode = newG.getRelationshipNode(nextPersonId, partnerId);
          if (relNode){
            let relProperties = newG.properties[relNode];
            if (relProperties['consangr'] !== 'Y'){
              relProperties['consangr'] = 'Y';
              // check if we can make it 'A'
              let nextGreatGrandParents = newG.getParentGenerations(nextPersonId, 3);
              let partnerGreatGrandParents = newG.getParentGenerations(partnerId, 3);
              for (let elem of nextGreatGrandParents) {
                if (partnerGreatGrandParents.has(elem)) {
                  // found common
                  relProperties['consangr'] = 'A';
                  break;
                }
              }
            }
          }
        }
      }
    }
    // PedigreeImport.validateBaseGraph(newG);

    return newG;
  } else {

    throw 'Unable to import pedigree: input is not a resource type we understand';
  }

};

GA4GHFHIRConverter.extractDataFromFMH = function (familyHistoryResource,
  nodeDataLookup, containedResourcesLookup, twinTracker) {

  let firstFamilyMember = familyHistoryResource.patient.reference;
  let secondFamilyMember = undefined;
  let rel = undefined;

  if (familyHistoryResource.extension){
    for (const ext of familyHistoryResource.extension){
      if (ext.url === 'http://hl7.org/fhir/StructureDefinition/familymemberhistory-patient-record'){
        secondFamilyMember = ext.valueReference.reference;
        break;
      }
    }
  }
  if (!firstFamilyMember || !secondFamilyMember) {
    return;
  }
  if (familyHistoryResource.relationship && familyHistoryResource.relationship.coding){
    for (const coding of familyHistoryResource.relationship.coding){
      if (coding.system === 'http://purl.org/ga4gh/rel.fhir'){
        rel = coding.code;
        break;
      }
    }
  }
  if (!rel){
    return; // didn't have a relationship
  }

  let firstNodeData = nodeDataLookup[firstFamilyMember];
  let secondNodeData = nodeDataLookup[secondFamilyMember];
  if (!firstNodeData || !secondNodeData) {
    return;
  }

  if (rel === 'REL:027') {
    // NMTH
    if ('mother' in firstNodeData && !('father' in firstNodeData)){
      // we already think we have a mother, may be a parent
      firstNodeData.father = firstNodeData.mother;
    }
    firstNodeData.mother = secondNodeData.nodeId;
  }
  else if (rel === 'REL:028'){
    // NFTH
    if ('father' in firstNodeData && !('mother' in firstNodeData)){
      // we already think we have a father, may be a parent
      firstNodeData.mother = firstNodeData.father;
    }
    firstNodeData.father = secondNodeData.nodeId;
  }
  else if (rel === 'REL:003' || rel === 'REL:022'){
    // NPRN or ADOPTPRN
    if (secondNodeData.gender === 'M' && !('father' in firstNodeData)){
      firstNodeData.father = secondNodeData.nodeId;
    }
    else if (secondNodeData.gender === 'F' && !('mother' in firstNodeData)){
      firstNodeData.mother = secondNodeData.nodeId;
    }
    else if (!('father' in firstNodeData)){
      firstNodeData.father = secondNodeData.nodeId;
    }
    else if (!('mother' in firstNodeData)){
      firstNodeData.mother = secondNodeData.nodeId;
    }
  }
  else if (rel === 'REL:026'){
    // SIGOTHR
    if ('partners' in firstNodeData){
      firstNodeData.partners.push(secondNodeData.nodeId);
    }
    else {
      firstNodeData.partners = [secondNodeData.nodeId];
    }
    if ('partners' in secondNodeData){
      secondNodeData.partners.push(firstNodeData.nodeId);
    }
    else {
      secondNodeData.partners = [firstNodeData.nodeId];
    }
  }
  else if (rel === 'REL:030'){
    // CONSANG
    if ('cpartners' in firstNodeData){
      firstNodeData.cpartners.push(secondNodeData.nodeId);
    }
    else {
      firstNodeData.cpartners = [secondNodeData.nodeId];
    }
    if ('cpartners' in secondNodeData){
      secondNodeData.cpartners.push(firstNodeData.nodeId);
    }
    else {
      secondNodeData.cpartners = [firstNodeData.nodeId];
    }
  }
  else if (rel === 'REL:009' || rel === 'REL:010' || rel === 'REL:011'){
    // TWIN or Monozygotic twin or Polyzygotic twin
    firstNodeData.properties.monozygotic = (rel === 'REL:010');
    secondNodeData.properties.monozygotic = (rel === 'REL:010');
    let firstNodeTwinGroup = twinTracker.lookup[firstNodeData.nodeId];
    let secondNodeTwinGroup = twinTracker.lookup[secondNodeData.nodeId];

    if (!firstNodeTwinGroup && !secondNodeTwinGroup){
      // new twin group
      twinTracker.lookup[firstNodeData.nodeId] = twinTracker.nextTwinGroupId;
      twinTracker.lookup[secondNodeData.nodeId] = twinTracker.nextTwinGroupId;
      twinTracker.groupIdLookup[twinTracker.nextTwinGroupId] = [firstNodeData.nodeId, secondNodeData.nodeId];
      twinTracker.nextTwinGroupId = twinTracker.nextTwinGroupId + 1;
    }
    else if (!firstNodeTwinGroup){
      // secondNode is already in a twin group
      twinTracker.lookup[firstNodeData.nodeId] = secondNodeTwinGroup;
      twinTracker.groupIdLookup[secondNodeTwinGroup].push(firstNodeData.nodeId);
    }
    else if (!secondNodeTwinGroup){
      // firstNode is already in a twin group
      twinTracker.lookup[secondNodeData.nodeId] = firstNodeTwinGroup;
      twinTracker.groupIdLookup[firstNodeTwinGroup].push(secondNodeData.nodeId);
    }
    else if (firstNodeTwinGroup != secondNodeTwinGroup){
      // they seem to exist to different twin groups, need to merge them
      for (const n of twinTracker.groupIdLookup[secondNodeTwinGroup]){
        twinTracker.lookup[n] = firstNodeTwinGroup;
        twinTracker.groupIdLookup[firstNodeTwinGroup].push(n);
      }
      delete twinTracker.groupIdLookup[secondNodeTwinGroup];
    }
  }

}

GA4GHFHIRConverter.extractDataFromCondition = function (conditionResource, nodeDataLookup, containedResourcesLookup, twinTracker) {
  if (!conditionResource.subject || !(conditionResource.subject in nodeDataLookup) || !conditionResource.code){
    // condition doesn't link to a subject in our list or has no code
    return;
  }

  let familyMember = conditionResource.subject;

  let nodeData = nodeDataLookup[familyMember];

  let disorderSystem = TerminologyManager.getCodeSystem(DisorderTermType);
  let foundCode = false;
  let conditionToAdd = undefined;

  if (conditionResource.code.coding){
    for (const coding of conditionResource.code.coding){
      if (coding.system === disorderSystem){
        conditionToAdd = coding.code;
        foundCode = true;
        break;
      }
    }
  }
  if (!foundCode && conditionResource.code.text){
    conditionToAdd = conditionResource.code.text;
  }
  if (conditionToAdd){
    if ('disorders' in nodeData.properties){
      nodeData.properties.disorders.push(conditionToAdd);
    }
    else {
      nodeData.properties.disorders = [conditionToAdd];
    }
  }


};

GA4GHFHIRConverter.extractDataFromObservation = function (observationResource, nodeDataLookup, containedResourcesLookup, twinTracker) {

  if (!observationResource.subject || !(observationResource.subject in nodeDataLookup)){
    // observation doesn't link to a subject in our list or has no code
    return;
  }

  let familyMember = observationResource.subject;

  let nodeData = nodeDataLookup[familyMember];

  let phenoTypeSystem = TerminologyManager.getCodeSystem(PhenotypeTermType);
  let geneSystem = TerminologyManager.getCodeSystem(GeneTermType);


  let isSympton = false;
  let isGene = false;
  let foundCode = false;
  let value = null;


  if (observationResource.valueCodeableConcept) {
    for (const coding of observationResource.valueCodeableConcept.coding){
      if (coding.system === 'http://snomed.info/sct' && coding.code === '87955000') {
        nodeData.properties['carrierStatus'] = 'carrier';
        foundCode = true;
        break;
      }
      else if (coding.system === 'http://snomed.info/sct' && coding.code === '24800002') {
        nodeData.properties['carrierStatus'] = 'presymptomatic';
        foundCode = true;
        break;
      }
      else if (coding.system === geneSystem) {
        foundCode = true;
        if ('candidateGenes' in nodeData.properties){
          nodeData.properties.candidateGenes.push(coding.code);
        }
        else {
          nodeData.properties.candidateGenes = [coding.code];
        }
        break;
      }
      else if (coding.system === phenoTypeSystem) {
        foundCode = true;
        if ('hpoTerms' in nodeData.properties){
          nodeData.properties.hpoTerms.push(coding.code);
        }
        else {
          nodeData.properties.hpoTerms = [coding.code];
        }
        break;
      }
    }
  }
  if (!foundCode){
    if (observationResource.code && observationResource.code.coding) {
      for (const coding of observationResource.code.coding) {
        if (coding.system === 'http://snomed.info/sct' && coding.code === '8619003') {
          nodeData.properties['childlessStatus'] = 'infertile';
          foundCode = true;
          break;
        }
        if (coding.system === 'http://snomed.info/sct' && coding.code === '224118004'
          && observationResource.valueInteger === 0) {
          nodeData.properties['childlessStatus'] = 'childless';
          foundCode = true;
          break;
        }
      }
    }
  }
  if (!foundCode){
    if (observationResource.valueString){
      if (observationResource.id.contains('_clinical_')){
        foundCode = true;
        if ('hpoTerms' in nodeData.properties){
          nodeData.properties.hpoTerms.push(observationResource.valueString);
        }
        else {
          nodeData.properties.hpoTerms = [observationResource.valueString];
        }
      }
      else if (observationResource.id.contains('_gene_')){
        foundCode = true;
        if ('candidateGenes' in nodeData.properties){
          nodeData.properties.candidateGenes.push(observationResource.valueString);
        }
        else {
          nodeData.properties.candidateGenes = [observationResource.valueString];
        }
      }
    }
  }
};


function broken(familyHistoryResource, subjectResource, containedResourcesLookup, twinTracker) {
  let properties = {};
  let result = {
    'properties': properties
  };

  properties.id = familyHistoryResource.id;
  properties.gender = 'U';

  let lookForTwins = true;
  if (twinTracker.lookup.hasOwnProperty(properties.id)) {
    let twinDataForThisNode = twinTracker.lookup[properties.id];
    properties.twinGroup = twinDataForThisNode.twinGroup;
    if (twinDataForThisNode.hasOwnProperty('monozygotic')) {
      properties.monozygotic = twinDataForThisNode.monozygotic;
    }
    lookForTwins = false;
  }

  if (familyHistoryResource.sex) {
    let foundCode = false;
    if (familyHistoryResource.sex.coding) {
      let codings = familyHistoryResource.sex.coding;
      for (let i = 0; i < codings.length; i++) {
        if (codings[i].system === 'http://hl7.org/fhir/administrative-gender') {
          foundCode = true;
          if (codings[i].code === 'male') {
            properties.gender = 'M';
          }
          if (codings[i].code === 'female') {
            properties.gender = 'F';
          }
          break;
        }
      }
    }
    if (!foundCode && familyHistoryResource.sex.text) {
      if (familyHistoryResource.sex.text.toLowerCase() === 'male') {
        properties.gender = 'M';
      } else if (familyHistoryResource.sex.text.toLowerCase() === 'female') {
        properties.gender = 'F';
      }
    }
  }
  if (familyHistoryResource.name) {
    // everything but the last word is the first name
    // a trailing '(name)' will be taken as last name at birth
    let nameSplitter = /^(.*?)( ([^ (]*)) ?(\(([^)]*)\))?$/;
    let nameSplit = nameSplitter.exec(familyHistoryResource.name);
    if (nameSplit == null) {
      properties.fName = familyHistoryResource.name;
    } else {
      properties.fName = nameSplit[1];
      properties.lName = nameSplit[3];
      if (nameSplit[5]) {
        properties.lNameAtB = nameSplit[5];
      }
    }
  }

  if (familyHistoryResource.identifier) {
    for (let i = 0; i < familyHistoryResource.identifier.length; i++) {
      if (familyHistoryResource.identifier[i].system === 'https://github.com/phenotips/open-pedigree?externalID') {
        properties.externalID = familyHistoryResource.identifier[i].value;
        break;
      }
    }
  }
  let dateSplitter = /([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2]|[1-9])(-(0[1-9]|[1-2][0-9]|3[0-1]|[1-9]))?)?/;
  if (familyHistoryResource.bornDate) {
    let bornDateSplit = dateSplitter.exec(familyHistoryResource.bornDate);
    if (bornDateSplit == null) {
      // failed to parse the data
    } else {
      let year = bornDateSplit[1];
      let month = (bornDateSplit[5]) ? bornDateSplit[5] : '01';
      let day = (bornDateSplit[7]) ? bornDateSplit[7] : '01';
      // properties.dob = day + "/" + month + "/" + year;
      properties.dob = month + '/' + day + '/' + year;
    }
  }
  if (familyHistoryResource.deceasedDate) {
    let deceasedDateSplit = dateSplitter.exec(familyHistoryResource.deceasedDate);
    if (deceasedDateSplit == null) {
      // failed to parse the data
    } else {
      let year = deceasedDateSplit[1];
      let month = (deceasedDateSplit[5]) ? deceasedDateSplit[5] : '01';
      let day = (deceasedDateSplit[7]) ? deceasedDateSplit[7] : '01';
      // properties.dod = day + "/" + month + "/" + year;
      properties.dod = month + '/' + day + '/' + year;
    }
  }

  if (familyHistoryResource.deceasedString) {
    let deceasedSplitter = /(stillborn|miscarriage|aborted|unborn)( ([1-9][0-9]?) weeks)?/;
    let deceasedSplit = deceasedSplitter.exec(familyHistoryResource.deceasedString);
    if (deceasedSplit == null) {
      // not something we understand
      properties.lifeStatus = 'deceased';
    } else {
      properties.lifeStatus = deceasedSplit[1];
      if (deceasedSplit[3]) {
        properties.gestationAge = deceasedSplit[3];
      }
    }
  }
  if (familyHistoryResource.deceasedBoolean) {
    properties.lifeStatus = 'deceased';
  }

  if (familyHistoryResource.note && familyHistoryResource.note[0].text) {
    properties.comments = familyHistoryResource.note[0].text;
  }
  if (familyHistoryResource.condition) {
    let disorders = [];
    // let disorderSystem = 'http://www.omim.org';
    let disorderSystem = TerminologyManager.getCodeSystem(DisorderTermType);//editor.getDisorderSystem();
    for (let i = 0; i < familyHistoryResource.condition.length; i++) {
      let condition = familyHistoryResource.condition[i].code;
      if (condition && condition.coding) {
        let foundSystem = false;
        for (let cIndex = 0; cIndex < condition.coding.length; cIndex++) {
          let coding = condition.coding[cIndex];
          if (coding.system === disorderSystem) {
            disorders.push(coding.code);
            foundSystem = true;
            break;
          }
        }
        if (!foundSystem) {
          let firstCoding = condition.coding[0];
          if (firstCoding.display) {
            disorders.push(firstCoding.code);
            continue;
          }
        } else {
          continue;
        }
      }
      if (condition && condition.text) {
        disorders.push(condition.text);
      }
    }
    properties.disorders = disorders;
  }

  if (familyHistoryResource.extension) {
    let motherCodes = ['NMTH', 'MTH', 'STPMTH', 'ADOPTM'];
    let fatherCodes = ['NFTH', 'FTH', 'STPFTH', 'ADOPTF'];
    let motherRegex = /mother/gi;
    let fatherRegex = /father/gi;
    let extensions = familyHistoryResource.extension;
    let possibleMother = [];
    let possibleFather = [];
    let possibleParent = [];
    let twinCodes = ['TWINSIS', 'TWINBRO'];
    let fraternalTwinCodes = ['FTWINSIS', 'FTWINBRO', 'TWIN'];
    let twinRegex = /twin/gi;
    let possibleTwins = null;

    for (let i = 0; i < extensions.length; i++) {
      let ex = extensions[i];
      if (ex.url === 'http://hl7.org/fhir/StructureDefinition/family-member-history-genetics-parent') {
        let type = undefined;
        let ref = undefined;
        let subExtensions = ex.extension;
        for (let j = 0; j < subExtensions.length; j++) {
          let subEx = subExtensions[j];
          if (subEx.url === 'type') {
            let codings = subEx.valueCodeableConcept.coding;
            for (let k = 0; k < codings.length; k++) {
              if (codings[k].system === 'http://terminology.hl7.org/CodeSystem/v3-RoleCode') {
                if (motherCodes.includes(codings[k].code)) {
                  type = 'mother';
                } else if (fatherCodes
                  .includes(codings[k].code)) {
                  type = 'father';
                } else {
                  type = 'parent';
                }
                break;
              } else if (codings[k].display) {
                if (motherRegex.test(codings[k].display)) {
                  type = 'mother';
                } else if (fatherRegex.test(codings[k].display)) {
                  type = 'father';
                }
              }
            }
            if (!type && subEx.valueCodeableConcept.text) {
              if (motherRegex
                .test(subEx.valueCodeableConcept.text)) {
                type = 'mother';
              } else if (fatherRegex
                .test(subEx.valueCodeableConcept.text)) {
                type = 'father';
              }
            }
            if (!type) {
              type = 'parent';
            }
          } else if (subEx.url === 'reference') {
            ref = subEx.valueReference.reference;
          }
        }
        if (ref == null) {
          // we didn't find the reference
          break;
        }
        if (!type || 'parent' === type ) {
          // check the reference entity for a gender
          if (containedResourcesLookup[ref]) {
            let parentResource = containedResourcesLookup[ref];
            if (parentResource.sex) {
              let foundCode = false;
              if (parentResource.sex.coding) {
                let codings = parentResource.sex.coding;
                for (let c = 0; c < codings.length; c++) {
                  if (codings[c].system === 'http://hl7.org/fhir/administrative-gender') {
                    foundCode = true;
                    if (codings[c].code === 'male') {
                      type = 'father';
                    }
                    if (codings[c].code === 'female') {
                      type = 'mother';
                    }
                    break;
                  }
                }
              }
              if (!foundCode && parentResource.sex.text) {
                if (familyHistoryResource.sex.text
                  .toLowerCase() === 'male') {
                  type = 'father';
                } else if (familyHistoryResource.sex.text
                  .toLowerCase() === 'female') {
                  type = 'mother';
                }
              }
            }
          }
        }
        let parentId = ref.substring(1); // remove leading #
        if (type === 'mother') {
          possibleMother.push(parentId);
        } else if (type === 'father') {
          possibleFather.push(parentId);
        } else {
          possibleParent.push(parentId);
        }
      } else if (ex.url === 'http://hl7.org/fhir/StructureDefinition/family-member-history-genetics-sibling') {
        let type = undefined;
        let ref = undefined;
        let subExtensions = ex.extension;
        for (let j = 0; j < subExtensions.length; j++) {
          let subEx = subExtensions[j];
          if (subEx.url === 'type') {
            let codings = subEx.valueCodeableConcept.coding;
            for (let k = 0; k < codings.length; k++) {
              if (codings[k].system === 'http://terminology.hl7.org/CodeSystem/v3-RoleCode') {
                if (twinCodes.includes(codings[k].code)) {
                  type = 'twin';
                } else if (fraternalTwinCodes
                  .includes(codings[k].code)) {
                  type = 'ftwin';
                } else {
                  type = 'sibling';
                }
                break;
              } else if (codings[k].display) {
                if (twinRegex.test(codings[k].display)) {
                  type = 'ftwin';
                }
              }
            }
            if (type == null && subEx.valueCodeableConcept.text) {
              if (twinRegex.test(subEx.valueCodeableConcept.text)) {
                type = 'ftwin';
              }
            }
            if (!type) {
              type = 'sibling';
            }
          } else if (subEx.url === 'reference') {
            ref = subEx.valueReference.reference;
          }
        }
        if (!ref || !type || 'sibling' === type) {
          // we didn't find the reference or its a sibling not a twin
          break;
        }
        if (possibleTwins == null) {
          possibleTwins = {};
        }
        possibleTwins[ref] = type;
      } else if (ex.url === 'http://hl7.org/fhir/StructureDefinition/family-member-history-genetics-observation') {
        let observationRef = ex.valueReference.reference;
        let observationResource = containedResourcesLookup[observationRef];
        if (observationResource) {
          let clinical = 'fmh_clinical';
          let genes = 'fmh_genes';
          let carrierOb = 'fmh_carrierStatus';
          let childlessOb = 'fmh_childlessStatus';
          let isSympton = false;
          let isGene = false;
          let value = null;
          // let hpoSystem = 'http://purl.obolibrary.org/obo/hp.owl';
          // let geneSystem = 'http://www.genenames.org';
          let hpoSystem = TerminologyManager.getCodeSystem(PhenotypeTermType);
          let geneSystem = TerminologyManager.getCodeSystem(GeneTermType);
          if (observationResource.id.substring(0, carrierOb.length) === carrierOb) {
            if (observationResource.valueCodeableConcept) {
              for (let cIndex = 0; cIndex < observationResource.valueCodeableConcept.coding.length; cIndex++) {
                let coding = observationResource.valueCodeableConcept.coding[cIndex];
                if (coding.system === 'http://snomed.info/sct' && coding.code === '87955000') {
                  properties['carrierStatus'] = 'carrier';
                  break;
                }
                if (coding.system === 'http://snomed.info/sct' && coding.code === '24800002') {
                  properties['carrierStatus'] = 'presymptomatic';
                  break;
                }
              }
            }
          } else if (observationResource.id.substring(0, childlessOb.length) === childlessOb) {
            if (observationResource.code) {
              for (let cIndex = 0; cIndex < observationResource.code.coding.length; cIndex++) {
                let coding = observationResource.code.coding[cIndex];
                if (coding.system === 'http://snomed.info/sct' && coding.code === '8619003') {
                  properties['childlessStatus'] = 'infertile';
                  break;
                }
                if (coding.system === 'http://snomed.info/sct' && coding.code === '224118004'
                  && observationResource.valueInteger === 0) {
                  properties['childlessStatus'] = 'childless';
                  break;
                }
              }
            }
          } else {
            if (observationResource.id.substring(0, clinical.length) === clinical) {
              isSympton = true;
            } else if (observationResource.id.substring(0, genes.length) === genes) {
              isGene = true;
            }
            if (observationResource.valueString) {
              value = observationResource.valueString;
            } else if (observationResource.valueCodeableConcept) {
              if (observationResource.valueCodeableConcept.coding) {
                for (let cIndex = 0; cIndex < observationResource.valueCodeableConcept.coding.length; cIndex++) {
                  let coding = observationResource.valueCodeableConcept.coding[cIndex];
                  if (coding.system === geneSystem) {
                    isGene = true;
                    value = coding.code;
                    break;
                  }
                  if (coding.system === hpoSystem) {
                    isSympton = true;
                    value = coding.code;
                    break;
                  }
                }
              }
              if (value == null && observationResource.valueCodeableConcept.text) {
                value = observationResource.valueCodeableConcept.text;
              }
            }
            if (value != null) {
              if (isSympton) {
                if (!properties.hpoTerms) {
                  properties.hpoTerms = [];
                }
                properties.hpoTerms.push(value);
              } else if (isGene) {
                if (!properties.candidateGenes) {
                  properties.candidateGenes = [];
                }
                properties.candidateGenes.push(value);
              }
            }
          }
        }
      }
    }
    if (possibleMother.length === 1) {
      result.mother = possibleMother[0];
    }
    if (possibleFather.length === 1) {
      result.father = possibleFather[0];
    }
    if (!result.father && possibleMother.length > 1) {
      result.father = possibleMother[1];
    }
    if (!result.mother && possibleFather.length > 1) {
      result.mother = possibleFather[1];
    }
    if (possibleParent.length > 0) {
      if (!result.mother) {
        result.mother = possibleParent[0];
      } else if (!result.father) {
        result.father = possibleParent[0];
      }
    }
    if (possibleParent.length > 1) {
      if (!result.mother) {
        result.mother = possibleParent[1];
      } else if (!result.father) {
        result.father = possibleParent[1];
      }
    }
    if (lookForTwins && possibleTwins != null) {
      // first check if all same type
      let isFraternal = false;
      let twinsToAdd = [];
      for (let key in possibleTwins) {
        if (containedResourcesLookup[key]) {
          twinsToAdd.push(containedResourcesLookup[key].id);
        } else {
          // don't check references we can't find
          continue;
        }
        if (possibleTwins[key] === 'ftwin') {
          isFraternal = true;
          break;
        }
      }
      if (twinsToAdd) {
        // we found some twins
        let twinGroup = twinTracker.nextTwinGroupId;
        twinTracker.nextTwinGroupId = twinTracker.nextTwinGroupId + 1;
        properties.twinGroup = twinGroup;
        if (!isFraternal) {
          properties.monozygotic = true;
        }
        for (let i = 0; i < twinsToAdd.length; i++) {
          let twinData = {twinGroup: twinGroup};
          if (!isFraternal) {
            twinData.monozygotic = true;
          }
          twinTracker.lookup[twinsToAdd[i]] = twinData;
        }
      }
    }
  }

  if (familyHistoryResource.relationship
    && familyHistoryResource.relationship.coding
    && familyHistoryResource.relationship.code === 'ONESELF') {
    // this is the patient, use the subject resource if we have one
    if (subjectResource) {
      if (subjectResource.gender === 'male') {
        properties.gender = 'M';
      } else if (subjectResource.gender === 'female') {
        properties.gender = 'F';
      }
    }
    //@TODO add code to grab patient name from patient resource
  }

  return result;
}


GA4GHFHIRConverter.extractDataFromPatient = function (patientResource,
  containedResourcesLookup, twinTracker) {
  let properties = {};
  let result = {
    'properties': properties
  };

  properties.id = patientResource.id;
  properties.gender = 'U';
  if (patientResource.gender === 'male') {
    properties.gender = 'M';
  } else if (patientResource.gender === 'female') {
    properties.gender = 'F';
  }

  const dateTimeSplitter = /([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?/;
  const nameUseOrder = ["anonymous", "temp", "expired_nickname", "expired_", "expired_usual", "expired_official", "maiden", "old", "nickname", "", "usual", "official"];
  let maxFNameUse = -2;
  let maxLNameUse = -2;
  let maxTextUse = -2;
  let nameText = '';
  if (patientResource.name) {
    for (const humanName of patientResource.name) {
      let use = humanName.use ? humanName.use : "";
      if (humanName.period && humanName.period.end) {
        const now = Date.now();
        const endDt = Date.parse(humanName.period.end);
        if (endDt < now) {
          use = 'expired_' + use;
        }
      }
      const nameUse = nameUseOrder.indexOf(use);
      if (humanName.family) {
        if (nameUse > maxLNameUse) {
          properties.lName = humanName.family;
          maxLNameUse = nameUse;
        }
      }
      if (humanName.given && humanName.given.size() > 0) {
        if (nameUse > maxFNameUse) {
          properties.fName = humanName.given.join(' ');
          maxFNameUse = nameUse;
        }
      }
      if (humanName.text) {
        if (nameUse > maxTextUse) {
          nameText = humanName.text;
          maxTextUse = nameUse;
        }
      }
    }
    if ((maxFNameUse == -2 || maxLNameUse == -2) && maxTextUse > -2) {
      // we are missing part of the name, see if we can get it form the text
      // everything but the last word is the first name
      // a trailing '(name)' will be taken as last name at birth
      let nameSplitter = /^(.*?)( ([^ (]*)) ?(\(([^)]*)\))?$/;
      let nameSplit = nameSplitter.exec(nameText);
      if (nameSplit == null) {
        if (maxLNameUse == -2 && maxFNameUse == -2) {
          properties.fName = nameSplit[1];
        }
      } else {
        if (maxFNameUse == -2) {
          properties.fName = nameSplit[1];
        }
        if (maxLNameUse == -2) {
          properties.lName = nameSplit[3];
        }
      }
    }
  }

  let dateSplitter = /([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2]|[1-9])(-(0[1-9]|[1-2][0-9]|3[0-1]|[1-9]))?)?/;
  if (patientResource.birthDate) {
    let bornDateSplit = dateSplitter.exec(patientResource.birthDate);
    if (bornDateSplit == null) {
      // failed to parse the data
    } else {
      let year = bornDateSplit[1];
      let month = (bornDateSplit[5]) ? bornDateSplit[5] : '01';
      let day = (bornDateSplit[7]) ? bornDateSplit[7] : '01';
      // properties.dob = day + "/" + month + "/" + year;
      properties.dob = month + '/' + day + '/' + year;
    }
  }

  if (patientResource.deceasedDateTime) {
    let deceasedDateSplit = dateTimeSplitter.exec(patientResource.deceasedDateTime);
    if (deceasedDateSplit == null) {
      // failed to parse the data
    } else {
      let year = deceasedDateSplit[1];
      let month = (deceasedDateSplit[5]) ? deceasedDateSplit[5] : '01';
      let day = (deceasedDateSplit[7]) ? deceasedDateSplit[7] : '01';
      // properties.dod = day + "/" + month + "/" + year;
      properties.dod = month + '/' + day + '/' + year;
    }
  }
  if (patientResource.deceasedBoolean) {
    properties.lifeStatus = 'deceased';
  }

  let checkUnbornExtension = true;
  if (patientResource.deceasedString) {
    let deceasedSplitter = /(stillborn|miscarriage|aborted|unborn)( ([1-9][0-9]?) weeks)?/;
    let deceasedSplit = deceasedSplitter.exec(patientResource.deceasedString);
    if (deceasedSplit == null) {
      // not something we understand
      properties.lifeStatus = 'deceased';
    } else {
      checkUnbornExtension = false;
      properties.lifeStatus = deceasedSplit[1];
      if (deceasedSplit[3]) {
        properties.gestationAge = deceasedSplit[3];
      }
    }
  }

  if (checkUnbornExtension && patientResource.extension) {
    for (const ext of patientResource.extension) {
      if (ext.url === 'http://purl.org/ga4gh/pedigree-fhir-ig/StructureDefinition/patient-unborn') {
        if (ext.valueBoolean) {
          properties.lifeStatus = 'unborn';
        }
        break;
      }
    }
  }

  return result;
};
// ===============================================================================================
/* ===============================================================================================
 *
 * Creates and returns a FHIR Composition representing the graph.
 *
 * ===============================================================================================
 */

GA4GHFHIRConverter.exportAsFHIR = function (pedigree, privacySetting, knownFhirPatienReference, pedigreeImage) {
  // let exportObj = [];
  let today = new Date();
  let tz = today.getTimezoneOffset();
  let tzHours = tz / 60;
  let tzMins = Math.abs(tz - (tzHours * 60));
  let date = today.getFullYear() + '-' + ((today.getMonth() < 9) ? '0' : '') + (today.getMonth() + 1) + '-'
    + ((today.getDate() < 10) ? '0' : '') + today.getDate();
  let time = ((today.getHours() < 10) ? '0' : '') + today.getHours() + ':' + ((today.getMinutes() < 10) ? '0' : '') + today.getMinutes() + ':'
    + ((today.getSeconds() < 10) ? '0' : '') + today.getSeconds();
  let timezone = ((tzHours >= 0) ? '+' : '') + tzHours + ':'
    + ((tzMins < 10) ? '0' : '') + tzMins;
  let dateTime = date + 'T' + time + timezone;

  let pedigreeIndividuals = {}; // will contain map of id/patient resource
  let pedigreeRelationship = []; // all the constructed relationships
  let conditions = {}; // constructed conditions keyed by patient
  let observations = {}; // constructed observations keyed by patient
  let nodeIndexToRef = {}; // maps node index to ref
  let containedResources = [];

  let probandRef = this.processTreeNode(0, pedigree, privacySetting, knownFhirPatienReference, pedigreeIndividuals,
    pedigreeRelationship, conditions, observations, nodeIndexToRef);

  // add any missing nodes, the recursion only goes up the tree
  for (let i = 1; i <= pedigree.GG.getMaxRealVertexId(); i++) {
    if (!pedigree.GG.isPerson(i)) {
      continue;
    }
    this.processTreeNode(i, pedigree, privacySetting, knownFhirPatienReference, pedigreeIndividuals,
      pedigreeRelationship, conditions, observations, nodeIndexToRef);
  }

  let probandReference = {
    'type': 'Patient',
    'reference': this.patRefAsRef(probandRef)
  };

  let probrandSection = {
    'title': 'Proband',
    'code': {
      'coding': [
        {
          'system': ' http://purl.org/ga4gh/pedigree-fhir-ig/CodeSystem/SectionType',
          'code': 'proband'
        }
      ]
    },
    'entry': [
      probandReference
    ]
  };

  let reasonSection = {
    'title': 'Reason collected',
    'code': {
      'coding': [
        {
          'system': ' http://purl.org/ga4gh/pedigree-fhir-ig/CodeSystem/SectionType',
          'code': 'reasonCollected'
        }
      ]
    },
    'entry': []
  };
  for (let probandCond of conditions[probandRef]) {
    reasonSection.entry.push({
      'type': 'Condition',
      'reference': '#' + probandCond.id
    });
  }

  let individualsSection = {
    'title': 'Individuals',
    'code': {
      'coding': [
        {
          'system': ' http://purl.org/ga4gh/pedigree-fhir-ig/CodeSystem/SectionType',
          'code': 'individuals'
        }
      ]
    },
    'entry': []
  };

  for (let pi in pedigreeIndividuals) {
    containedResources.push(pedigreeIndividuals[pi]);
    individualsSection.entry.push({
      'type': 'Patient',
      'reference': this.patRefAsRef(nodeIndexToRef[pi])
    });
  }

  let relationshipSection = {
    'title': 'Relationships',
    'code': {
      'coding': [
        {
          'system': ' http://purl.org/ga4gh/pedigree-fhir-ig/CodeSystem/SectionType',
          'code': 'relationships'
        }
      ]
    },
    'entry': []
  };
  for (let pr of pedigreeRelationship) {
    containedResources.push(pr);
    relationshipSection.entry.push({
      'type': 'FamilyMemberHistory',
      'reference': '#' + pr.id
    });
  }

  let otherSection = {
    'title': 'Other',
    'code': {
      'coding': [
        {
          'system': ' http://purl.org/ga4gh/pedigree-fhir-ig/CodeSystem/SectionType',
          'code': 'other'
        }
      ]
    },
    'entry': []
  };

  for (let key in conditions) {
    for (let con of conditions[key]) {
      containedResources.push(con);
      otherSection.entry.push({
        'type': 'Condition',
        'reference': '#' + con.id
      });
    }
  }
  for (let key in observations) {
    for (let ob of observations[key]) {
      containedResources.push(ob);
      otherSection.entry.push({
        'type': 'Observation',
        'reference': '#' + ob.id
      });
    }
  }
  let composition = {
    'resourceType': 'Composition',
    'meta': {
      'profile': [
        'http://purl.org/ga4gh/pedigree-fhir-ig/StructureDefinition/Pedigree'
      ]
    },
    'status': 'final',
    'type': {
      'coding': [
        {
          'system': 'http://snomed.info/sct',
          'code': '422432008'
        }
      ]
    },
    'subject': probandReference,
    'date': dateTime,
    'title': 'Pedigree',
    'section': [
      probrandSection,
      reasonSection,
      individualsSection,
      relationshipSection,
      otherSection],
    'contained': containedResources
  };


  if (pedigreeImage) {

    composition.section.push({
      'title': 'Pedigree Diagram',
      'code': {
        'coding': [
          {
            'system': ' http://purl.org/ga4gh/pedigree-fhir-ig/CodeSystem/SectionType',
            'code': 'pedigreeImage'
          }
        ]
      },
      'entry': [{
        'type': 'DocumentReference',
        'reference': '#pedigreeImage'
      }]
    });
    let pedigreeImageDocumentReference = {
      'id': 'pedigreeImage',
      'resourceType': 'DocumentReference',
      'status': 'current',
      'docStatus': 'preliminary',
      'subject': probandReference,
      'description': 'Pedigree Diagram of Family in SVG format',
      'content': {
        'attachment': {
          'contentType': 'image/svg+xml',
          'data': btoa(unescape(encodeURIComponent(pedigreeImage)))
        }
      }
    };
    containedResources.push(pedigreeImageDocumentReference);
  }


  return JSON.stringify(composition, null, 2);
};


GA4GHFHIRConverter.familyHistoryLookup = {
  'notFound': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:001',
    'display': 'Relative'
  },
  'REL:001': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:001',
    'display': 'Relative'
  },
  'REL:002': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:002',
    'display': 'Biological relative'
  },
  'REL:003': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:003',
    'display': 'Biological parent'
  },
  'REL:004': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:004',
    'display': 'Sperm / ovum donor'
  },
  'REL:005': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:005',
    'display': 'Gestational carrier'
  },
  'REL:006': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:006',
    'display': 'Surrogate ovum donor'
  },
  'REL:007': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:007',
    'display': 'Biological sibling'
  },
  'REL:008': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:008',
    'display': 'Full sibling'
  },
  'REL:009': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:009',
    'display': 'Twin'
  },
  'REL:010': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:010',
    'display': 'Monozygotic twin'
  },
  'REL:011': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:011',
    'display': 'Polyzygotic twin'
  },
  'REL:012': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:012',
    'display': 'Half-sibling'
  },
  'REL:013': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:013',
    'display': 'parental-sibling'
  },
  'REL:014': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:014',
    'display': 'Cousin'
  },
  'REL:015': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:015',
    'display': 'Maternal cousin'
  },
  'REL:016': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:016',
    'display': 'Paternal cousin'
  },
  'REL:017': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:017',
    'display': 'Grandparent'
  },
  'REL:018': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:018',
    'display': 'Great-grandparent'
  },
  'REL:019': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:019',
    'display': 'Social / legal relative'
  },
  'REL:020': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:020',
    'display': 'Parent figure'
  },
  'REL:021': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:021',
    'display': 'Foster parent'
  },
  'REL:022': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:022',
    'display': 'Adoptive parent'
  },
  'REL:023': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:023',
    'display': 'Step-parent'
  },
  'REL:024': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:024',
    'display': 'Sibling figure'
  },
  'REL:025': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:025',
    'display': 'Step-sibling'
  },
  'REL:026': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:026',
    'display': 'Significant other'
  },
  'REL:027': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:027',
    'display': 'Biological mother'
  },
  'REL:028': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:028',
    'display': 'Biological father'
  },
  'REL:029': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:029',
    'display': 'mitochondrial donor'
  },
  'REL:030': {
    'system': 'http://purl.org/ga4gh/rel.fhir',
    'code': 'REL:030',
    'display': 'Consanguineous partner'
  }

};


GA4GHFHIRConverter.relationshipMap = {
  'NMTH':      'REL:027',
  'NFTH':      'REL:028',
  'NPRN':      'REL:003',
  'ADOPTMTH':  'REL:022',
  'ADOPTFTH':  'REL:022',
  'ADOPTPRN':  'REL:022',
  'SIGOTHR':   'REL:026',
  'CONSANG':   'REL:030',
  'TWIN':      'REL:009',
  'TWINSIS':   'REL:010',
  'TWINBRO':   'REL:010',
  'FTWINSIS':  'REL:011',
  'FTWINBRO':  'REL:011',
};

GA4GHFHIRConverter.processTreeNode = function (index, pedigree, privacySetting, knownFhirPatienReference,
  pedigreeIndividuals, pedigreeRelationship, condtions, observations, nodeIndexToRef) {

  if (pedigreeIndividuals[index]) {
    // already processed
    return pedigreeIndividuals[index].id;
  }

  const nodeProperties = pedigree.GG.properties[index];
  const externalId = nodeProperties['externalID'];
  let ref = (knownFhirPatienReference && externalId && knownFhirPatienReference[externalId]) ? knownFhirPatienReference[externalId] : 'PI_' + index;
  nodeIndexToRef[index] = ref;
  pedigreeIndividuals[index] = this.buildPedigreeIndividual(ref, nodeProperties, privacySetting);


  this.addConditions(nodeProperties, ref, condtions);

  this.addObservations(nodeProperties, ref, observations);

  let relationshipsToBuild = {};

  let isAdopted = pedigree.GG.isAdopted(index);
  let parents = pedigree.GG.getParents(index);

  let mother = pedigree.GG.getMother(index) || -1;
  let father = pedigree.GG.getFather(index) || -2;

  if (mother < index || father < index) {
    // could be no gender

    if (parents.length > 0) {
      if (mother === parents[0]) {
        father = parents[1];
      } else if (mother === parents[1]) {
        father = parents[0];
      } else if (father === parents[0]) {
        mother = parents[1];
      } else if (father === parents[1]) {
        mother = parents[0];
      }
    }
  }
  if (mother > 0) {
    relationshipsToBuild[mother] = (isAdopted) ? 'ADOPTMTH' : 'NMTH';
  }
  if (father > 0) {
    relationshipsToBuild[father] = (isAdopted) ? 'ADOPTFTH' : 'NFTH';
  }
  for (let i = 0; i < parents.length; i++) {
    if (!relationshipsToBuild[parents[i]]) {
      relationshipsToBuild[parents[i]] = (isAdopted) ? 'ADOPTPRN' : 'NPRN';
    }
  }

  // add partners
  let partners = pedigree.GG.getAllPartners(index);
  for (let i = 0; i < partners.length; i++) {
    if (!pedigreeIndividuals[partners[i]]) {
      relationshipsToBuild[partners[i]] = 'SIGOTHR'
      let relNode = pedigree.GG.getRelationshipNode(index, partners[i]);

      if (relNode != null) {
        let relProperties = pedigree.GG.properties[relNode];
        let consangr = relProperties['consangr'] ? relProperties['consangr'] : 'A';
        if (consangr === 'Y'){
          relationshipsToBuild[partners[i]] = 'CONSANG';
        }
        else if (consangr === 'A') {
         // spec says second cousins or closer, A second cousin is a someone who shares a great-grandparent with you
         // so make a list of parents going back 3 generations and look for any common nodes
          let myGreatGrandParents = pedigree.GG.getParentGenerations(index, 3);
          let partnerGreatGrandParents = pedigree.GG.getParentGenerations(partners[i], 3);
          for (let elem of myGreatGrandParents) {
            if (partnerGreatGrandParents.has(elem)) {
              // found common
              relationshipsToBuild[partners[i]] = 'CONSANG';
              break;
            }
          }
        }
      }

    }
  }
  //add twins
  let twinGroupId = pedigree.GG.getTwinGroupId(index);
  if (twinGroupId != null) {
    // this person is a twin
    let siblingsToAdd = pedigree.GG.getAllTwinsOf(index);
    for (let i = 0; i < siblingsToAdd.length; i++) {
      if (siblingsToAdd[i] !== index) {
        let siblingId = siblingsToAdd[i];
        if (!pedigreeIndividuals[siblingId]) {
          let gender = pedigree.GG.getGender(siblingId);
          let monozygotic = pedigree.GG.properties[siblingId]['monozygotic'] === true;
          let rel = 'TWIN';
          if (gender === 'F') {
            rel = (monozygotic) ? 'TWINSIS' : 'FTWINSIS';
          } else if (gender === 'M') {
            rel = (monozygotic) ? 'TWINBRO' : 'FTWINBRO';
          }
          relationshipsToBuild[siblingId] = rel;
        }
      }
    }
  }
  for (let relIndex in relationshipsToBuild) {
    // recursion
    let relRef = this.processTreeNode(relIndex, pedigree, privacySetting, knownFhirPatienReference, pedigreeIndividuals,
      pedigreeRelationship, condtions, observations, nodeIndexToRef);
    pedigreeRelationship.push(this.buildPedigreeRelation(ref, relRef, relationshipsToBuild[relIndex]));
  }
  return ref;
};

GA4GHFHIRConverter.patRefAsId = function (ref) {
  if (ref.startsWith('Patient/')) {
    return ref.substring(8);
  }
  return ref;
};

GA4GHFHIRConverter.patRefAsRef = function (ref) {
  if (ref.startsWith('Patient/')) {
    return ref;
  }
  return '#' + ref;
};


GA4GHFHIRConverter.buildPedigreeIndividual = function (containedId, nodeProperties, privacySetting) {
  let patientResource = {
    'id': this.patRefAsId(containedId),
    'resourceType': 'Patient',
    'meta': {
      'profile': [
        'http://purl.org/ga4gh/pedigree-fhir-ig/StructureDefinition/PedigreeIndividual'
      ]
    },
    'extension': []
  };

  // sex
  if (nodeProperties.gender) {
    if (nodeProperties.gender === 'M') {
      patientResource.gender = 'male';
    } else if (nodeProperties.gender === 'F') {
      patientResource.gender = 'female';
    } else {
      patientResource.gender = 'unknown';
    }
  }
  let unbornFlag = false;
  if (privacySetting === 'all') {
    if (nodeProperties['dob']) {
      let d = new Date(nodeProperties['dob']);
      patientResource['birthDate'] = d.getFullYear() + '-'
        + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() <= 9 ? '0' : '') + d.getDate();
    }
    if (nodeProperties['dod']) {
      let d = new Date(nodeProperties['dod']);
      patientResource['deceasedDateTime'] = d.getFullYear() + '-'
        + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() <= 9 ? '0' : '') + d.getDate();
    } else if (nodeProperties['lifeStatus']) {
      let lifeStatus = nodeProperties['lifeStatus'];
      if (lifeStatus === 'stillborn' || lifeStatus === 'miscarriage' || lifeStatus === 'aborted' || lifeStatus === 'unborn') {
        unbornFlag = true;
        if (nodeProperties.hasOwnProperty('gestationAge')) {
          patientResource['deceasedString'] = lifeStatus + ' ' + nodeProperties['gestationAge'] + ' weeks';
        } else {
          patientResource['deceasedString'] = lifeStatus;
        }
      } else if (lifeStatus === 'deceased') {
        patientResource['deceasedBoolean'] = true;
      }
    }
  } else {
    if (nodeProperties['dod']) {
      patientResource['deceasedBoolean'] = true;
    } else if (nodeProperties['lifeStatus']) {
      let lifeStatus = nodeProperties['lifeStatus'];
      if (lifeStatus === 'stillborn' || lifeStatus === 'miscarriage' || lifeStatus === 'aborted' || lifeStatus === 'unborn') {
        unbornFlag = true;
        if (nodeProperties.hasOwnProperty('gestationAge')) {
          unbornFlag = true;
          patientResource['deceasedString'] = lifeStatus + ' ' + nodeProperties['gestationAge'] + ' weeks';
        } else {
          unbornFlag = true;
          patientResource['deceasedString'] = lifeStatus;
        }
      } else if (lifeStatus === 'deceased') {
        unbornFlag = true;
        patientResource['deceasedBoolean'] = true;
      }
    }
  }

  patientResource.extension.push({
    'url': 'http://purl.org/ga4gh/pedigree-fhir-ig/StructureDefinition/patient-unborn',
    'valueBoolean': unbornFlag
  }
  );

  if (nodeProperties.twinGroup) {
    patientResource.multipleBirthBoolean = true;
  }

  // name
  if (privacySetting === 'all') {

    if (nodeProperties.lName || nodeProperties.fName || nodeProperties.lNameAtB) {
      patientResource.name = [];
      if (nodeProperties.lName || nodeProperties.fName) {
        let name = {};
        if (nodeProperties.lName) {
          name.family = nodeProperties.lName;
        }
        if (nodeProperties.fName) {
          name.given = [nodeProperties.fName];
        }
        patientResource.name.push(name);
      }
      if (nodeProperties.lNameAtB && nodeProperties.lNameAtB !== nodeProperties.lName) {
        let name = {
          'use': 'old',
          'family': nodeProperties.lNameAtB
        };
        patientResource.name.push(name);
      }
    }
  }
  return patientResource;
};

GA4GHFHIRConverter.buildPedigreeRelation = function (ref, relRef, relationship) {
  return {
    'resourceType': 'FamilyMemberHistory',
    'id': this.patRefAsId(ref) + '_' + this.patRefAsId(relRef) + '_Relationship',
    'meta': {
      'profile': [
        ' http://purl.org/ga4gh/pedigree-fhir-ig/StructureDefinition/PedigreeRelationship'
      ]
    },
    'extension': [
      {
        'url': 'http://hl7.org/fhir/StructureDefinition/familymemberhistory-patient-record',
        'valueReference': {
          'reference': this.patRefAsRef(relRef)
        }
      }
    ],
    'status': 'completed',
    'patient': {
      'reference': this.patRefAsRef(ref)
    },
    'relationship': {
      'coding': [
        GA4GHFHIRConverter.familyHistoryLookup[GA4GHFHIRConverter.relationshipMap[relationship]]
      ]
    }
  };
};

GA4GHFHIRConverter.addConditions = function (nodeProperties, ref, condtions) {
  let conditionsForRef = [];
  if (nodeProperties['disorders']) {
    let disorders = nodeProperties['disorders'];
    let disorderLegend = editor.getDisorderLegend();
    // let disorderSystem = 'http://www.omim.org';
    let disorderSystem = TerminologyManager.getCodeSystem(DisorderTermType);//editor.getDisorderSystem();
    for (let i = 0; i < disorders.length; i++) {
      let disorderTerm = disorderLegend.getTerm(disorders[i]);
      let fhirCondition = {
        'resourceType': 'Condition',
        'id': this.patRefAsId(ref) + '_cond_' + i,
        'subject': this.patRefAsRef(ref)
      };
      if (disorderTerm.getName() === disorders[i]) {
        // name and ID the same, must not be from omim
        fhirCondition.code = {
          'text': disorders[i]
        };
      } else {
        // disorder from omim
        fhirCondition.code = {
          'coding': [
            {
              'system': disorderSystem,
              'code': disorders[i],
              'display': disorderTerm.getName()
            }
          ]
        };
      }

      conditionsForRef.push(fhirCondition);
    }
  }
  condtions[ref] = conditionsForRef;
};

GA4GHFHIRConverter.addObservations = function (nodeProperties, ref, observations) {
  let observationsForRef = [];
  if (nodeProperties['hpoTerms']) {
    let hpoTerms = nodeProperties['hpoTerms'];
    let hpoLegend = editor.getHPOLegend();
    // let hpoSystem = 'http://purl.obolibrary.org/obo/hp.owl';
    let hpoSystem = TerminologyManager.getCodeSystem(PhenotypeTermType);

    for (let j = 0; j < hpoTerms.length; j++) {
      let fhirObservation = {
        'resourceType': 'Observation',
        'id': this.patRefAsId(ref) + '_clinical_' + j,
        'status': 'preliminary',
        'subject': this.patRefAsRef(ref)
      };
      let hpoTerm = hpoLegend.getTerm(hpoTerms[j]);
      if (hpoTerm.getName() === hpoTerms[j]) {
        fhirObservation['valueString'] = hpoTerms[j];
      } else {
        fhirObservation['valueCodeableConcept'] = {
          'coding': [{
            'system': hpoSystem,
            'code': hpoTerms[j],
            'display': hpoTerm.getName()
          }]
        };
      }
      observationsForRef.push(fhirObservation);
    }
  }

  if (nodeProperties['candidateGenes']) {
    let candidateGenes = nodeProperties['candidateGenes'];
    let geneLegend = editor.getGeneLegend();
    //let geneSystem = 'http://www.genenames.org';
    let geneSystem = TerminologyManager.getCodeSystem(GeneTermType);
    for (let j = 0; j < candidateGenes.length; j++) {
      // @TODO change to use http://build.fhir.org/ig/HL7/genomics-reporting/obs-region-studied.html
      let fhirObservation = {
        'resourceType': 'Observation',
        'id': this.patRefAsId(ref) + '_gene_' + j,
        'status': 'preliminary',
        'subject': this.patRefAsRef(ref)
      };
      let geneTerm = geneLegend.getTerm(candidateGenes[j]);
      if (geneTerm.getName() === candidateGenes[j]) {
        fhirObservation['valueString'] = candidateGenes[j];
      } else {
        fhirObservation['valueCodeableConcept'] = {
          'coding': [{
            'system': geneSystem,
            'code': candidateGenes[j],
            'display': geneTerm.getName()
          }]
        };
      }
      observationsForRef.push(fhirObservation);
    }
  }

  //carrierStatus -'affected' or 'carrier' 'presymptomatic'
  // For carrier status:
  // Carrier:
  //   Code: 87955000 | Carrier state, disease expressed |
  //   Value: empty
  // Pre-symptomatic:
  //   Code: 24800002 | Carrier state, disease not expressed |
  //   Value: empty
  if (nodeProperties['carrierStatus']) {
    let carrierCode = undefined;
    if (nodeProperties['carrierStatus'] === 'carrier') {
      carrierCode = {
        'coding': [{
          'system': 'http://snomed.info/sct',
          'code': '87955000',
          'display': 'Carrier state, disease expressed'
        }]
      };
    } else if (nodeProperties['carrierStatus'] === 'presymptomatic') {
      carrierCode = {
        'coding': [{
          'system': 'http://snomed.info/sct',
          'code': '24800002',
          'display': 'Carrier state, disease not expressed'
        }]
      };
    }
    if (carrierCode) {
      let fhirObservation = {
        'resourceType': 'Observation',
        'id': this.patRefAsId(ref) + '_carrierStatus',
        'status': 'preliminary',
        'valueCodeableConcept': carrierCode,
        'subject': this.patRefAsRef(ref)
      };
      observationsForRef.push(fhirObservation);
    }
  }
  //childlessStatus - 'childless' or 'infertile'
  //Childless:
  //   Code: 224118004 | Number of offspring |
  //   Value: 0
  // Infertile:
  //   Code: 8619003 | Infertile |
  //   Value: empty
  if (nodeProperties['childlessStatus']) {
    let childlessCode = undefined;
    let addZeroValue = false;
    if (nodeProperties['childlessStatus'] === 'childless') {
      childlessCode = {
        'coding': [{
          'system': 'http://snomed.info/sct',
          'code': '224118004',
          'display': 'Number of offspring'
        }]
      };
      addZeroValue = true;
    } else if (nodeProperties['childlessStatus'] === 'infertile') {
      childlessCode = {
        'coding': [{
          'system': 'http://snomed.info/sct',
          'code': '8619003',
          'display': 'Infertile'
        }]
      };
    }
    if (childlessCode) {
      let fhirObservation = {
        'resourceType': 'Observation',
        'id': this.patRefAsId(ref) + '_childlessStatus',
        'status': 'preliminary',
        'code': childlessCode,
        'subject': this.patRefAsRef(ref)
      };
      if (addZeroValue){
        fhirObservation.valueInteger = 0;
      }
      observationsForRef.push(fhirObservation);
    }
  }
  observations[ref] = observationsForRef;
};
//===============================================================================================

export default GA4GHFHIRConverter;
