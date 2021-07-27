import BaseGraph from 'pedigree/model/baseGraph';
import RelationshipTracker from 'pedigree/model/relationshipTracker';
import NameSplitter from '../util/NameSplitter';



function splitDate(dateString){
  let ymdRegex =/^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1]))?)?$/;
  let dmyRegex =/^(((0?[1-9]|[1-2][0-9]|3[0-1])-)?(0?[1-9]|1[0-2])-)?([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)$/;
  let yearsRegex =/^([0-9]{1,3})\s*(y|yrs|years)$/i;
  let monthsRegex =/^([0-9]{1,2})\s*(m|mths|months)$/i;
  let weeksRegex =/^([0-9]{1,2})\s*(w|wks|weeks)$/i;

  let dateSplit = ymdRegex.exec(dateString);
  if (dateSplit != null){
    let result = { year: parseInt(dateSplit[1]) };
    if (dateSplit[5] && dateSplit[5].length == 2){
      result.month = parseInt(dateSplit[5]);
    }
    if (dateSplit[7] && dateSplit[7].length == 2){
      result.day = parseInt(dateSplit[7]);
    }
    return result;
  }
  dateSplit = dmyRegex.exec(dateString);
  if (dateSplit != null){
    let result = { year: parseInt(dateSplit[5]) };
    if (dateSplit[4] && dateSplit[4].length > 0){
      result.month = parseInt(dateSplit[4]);
    }
    if (dateSplit[3] && dateSplit[3].length > 0){
      result.day = parseInt(dateSplit[3]);
    }
    return result;
  }
  dateSplit = yearsRegex.exec(dateString);
  if (dateSplit != null){
    return { age: dateSplit[1] + 'y'};
  }
  dateSplit = monthsRegex.exec(dateString);
  if (dateSplit != null){
    return { age: dateSplit[1] + 'm'};
  }
  dateSplit = weeksRegex.exec(dateString);
  if (dateSplit != null){
    return { age: dateSplit[1] + 'w'};
  }

  return undefined;
}

var QuestionnaireConverter = function () {
};

QuestionnaireConverter.prototype = {};

QuestionnaireConverter.initFromQuestionnaire = function (questionnaireData) {
  let nodeData = [];

  let nodeByTag = {};
  let newG = new BaseGraph();
  let nameToID = {};
  let externalIDToID = {};
  let ambiguousReferences = {};
  let hasID = {};

  for (const qNode of questionnaireData) {
    let person = QuestionnaireConverter.extractDataFromQuestionnaireNode(qNode);
    nodeData.push(person);
    nodeByTag[qNode.tag] = person;
  }
  // try to add parent links
  let partners = [];
  let maxChildId = 0;
  for (const person of nodeData){
    QuestionnaireConverter.addParents(person, nodeByTag);
    if (person.qNode.tag.startsWith('partner_')){
      partners.push(person);
    }
    if (person.qNode.tag.startsWith('child_')){
      let childId = parseInt(person.qNode.tag.substring(6));
      if (childId > maxChildId){
        maxChildId = childId;
      }
    }
  }

  for (let p of partners){
    if (p.children.size === 0){
      // we need to make a fake child
      maxChildId++;
      let childTag = 'child_' + maxChildId.toString();
      let fakeChild = {
        properties: {id: childTag, gender: 'U'},
        qNode: { tag: childTag, parent_tag: p.qNode.tag},
        parents: [nodeByTag.proband, p],
        children: new Set(),
        partners: new Set()
      };
      p.children.add(fakeChild);
      nodeByTag.proband.children.add(fakeChild);
      nodeByTag.proband.partners.add(p);
      p.partners.add(nodeByTag.proband);
      nodeData.push(fakeChild);
      nodeByTag[childTag] = fakeChild;
    }
  }


  QuestionnaireConverter.populateDistanceFromProband(nodeByTag.proband, 0);

  let fakeNodes = {};
  let badNodes = [];
  for (const person of nodeData){
    if (!('dfp' in person)){
      // we found a node that is not connected to anything
      let cluster = new Set();
      QuestionnaireConverter.buildConnectedCluster(person, cluster);
      let connectionNode = cluster.size == 1 ? person: QuestionnaireConverter.findBestConnectInCluster(cluster);
      QuestionnaireConverter.addMissingNodes(person, nodeByTag, fakeNodes, badNodes);
      for (let node of cluster){
        // give a dfp so we don't reprocess the node
        node.dfp = 1000;
      }
    }
  }

  for (let fakeNodeTag in fakeNodes){
    if (fakeNodeTag in nodeByTag){
      // we already have this node.. something is not connected correctly
      delete fakeNodes[fakeNodeTag];
    } else {
      nodeByTag[fakeNodeTag] = fakeNodes[fakeNodeTag];
      nodeData.push(fakeNodes[fakeNodeTag]);
    }
  }
  for (let fakeNodeTag in fakeNodes){
    QuestionnaireConverter.connectFakeNode(fakeNodes[fakeNodeTag], nodeByTag);
  }


  for (const person of nodeData){
    if (!person.properties.hasOwnProperty('id')
      && !person.properties.hasOwnProperty('fName')
      && !person.properties.hasOwnProperty('externalId')) {
      throw 'Unable to import pedigree: a node with no ID or name is found';
    }
    if (('mother' in person) && person.mother === undefined){
      console.log('Person has a mother of undefined after connecting');
    }
    console.log(person);
    let pedigreeID = newG._addVertex(null, BaseGraph.TYPE.PERSON, person.properties,
      newG.defaultPersonNodeWidth);

    person.nodeId = pedigreeID;

    if (person.properties.id) {
      if (externalIDToID.hasOwnProperty(person.properties.id)) {
        throw 'Unable to import pedigree: multiple persons with the same ID ['
        + person.properties.id + ']';
      }
      if (nameToID.hasOwnProperty(person.properties.id)
        && nameToID[person.properties.id] !== pedigreeID) {
        delete nameToID[person.properties.id];
        ambiguousReferences[person.properties.id] = true;
      } else {
        externalIDToID[person.properties.id] = pedigreeID;
        hasID[person.properties.id] = true;
      }
    }
    if (person.properties.fName) {
      if (nameToID.hasOwnProperty(person.properties.fName)
        && nameToID[person.properties.fName] !== pedigreeID) {
        // multiple nodes have this first name
        delete nameToID[person.properties.fName];
        ambiguousReferences[person.properties.fName] = true;
      } else if (externalIDToID.hasOwnProperty(person.properties.fName)
        && externalIDToID[person.properties.fName] !== pedigreeID) {
        // some other node has this name as an ID
        delete externalIDToID[person.properties.fName];
        ambiguousReferences[person.properties.fName] = true;
      } else {
        nameToID[person.properties.fName] = pedigreeID;
      }
    }
    // only use externalID if id is not present
    if (person.properties.hasOwnProperty('externalId')
      && !hasID.hasOwnProperty(pedigreeID)) {
      externalIDToID[person.properties.externalId] = pedigreeID;
      hasID[pedigreeID] = true;
    }
  }
  // try to add parent links
  for (const person of nodeData){
    QuestionnaireConverter.addParents(person, nodeByTag);
  }


  let defaultEdgeWeight = 1;

  let relationshipTracker = new RelationshipTracker(newG,
    defaultEdgeWeight);

  // second pass (once all vertex IDs are known): process parents/children & add edges
  for (const person of nodeData){

    let personID = person.nodeId;

    if ('parents' in person){
      let reprocess = [];
      for (let p of person.parents){
        if (p.properties.gender === 'M' && !person.father){
          person.father = p;
        } else if (p.properties.gender === 'F' && !person.mother){
          person.mother = p;
        } else if (p.properties.gender === 'U'){
          reprocess.push(p);
        }
      }
      for (let p of reprocess){
        if (!person.father && person.mother !== p){
          person.father = p;
        } else if (!person.mother && person.father !== p){
          person.mother = p;
        }
      }
    }
    let motherLink = person.hasOwnProperty('mother') ? person['mother'].nodeId
      : null;
    let fatherLink = person.hasOwnProperty('father') ? person['father'].nodeId
      : null;


    if (motherLink == null && fatherLink == null) {
      continue;
    }

    // create a virtual parent in case one of the parents is missing
    let fatherID = null;
    let motherID = null;
    if (fatherLink == null) {
      fatherID = newG._addVertex(null, BaseGraph.TYPE.PERSON, {
        'gender' : 'M',
        'comments' : 'unknown'
      }, newG.defaultPersonNodeWidth);
    } else {
      fatherID = fatherLink;
      if (newG.properties[fatherID].gender === 'F') {
        throw 'Unable to import pedigree: a person declared as female is also declared as being a father ('
        + fatherLink + ')';
      }
    }
    if (motherLink == null) {
      motherID = newG._addVertex(null, BaseGraph.TYPE.PERSON, {
        'gender' : 'F',
        'comments' : 'unknown'
      }, newG.defaultPersonNodeWidth);
    } else {
      motherID = motherLink;
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
    let chhubID = relationshipTracker.createOrGetChildhub(motherID, fatherID);
    console.log("Add edge for edge, child, mother, father", chhubID, personID, motherID, fatherID);
    newG.addEdge(chhubID, personID, defaultEdgeWeight);
  }

  newG.validate();
  // PedigreeImport.validateBaseGraph(newG);
  return newG;
};

QuestionnaireConverter.extractDataFromQuestionnaireNode = function (qNode) {
  let properties = {id: qNode.tag};
  let result = {
    properties: properties,
    qNode: qNode,
    partners: new Set(),
    children: new Set()
  };
  // John Smith
  // 11.13.67 (or age)
  // Atrial fibrillation dx 23y
  // d. 43y
  const commentOrder = ['name', 'dob', 'problem', 'dod'];
  let comments = {};

  // name
  const splitName = NameSplitter.split(qNode.name);
  result.splitName = splitName;
  if ('first' in splitName){
    properties.fName = splitName.first.join(' ');
  }
  if ('surname' in splitName){
    properties.lName = splitName.surname;
  }
  if ('maiden' in splitName){
    properties.lNameAtB = splitName.maiden;
  }

  // maiden name
  if ('maiden_name' in qNode){
    properties.lNameAtB = qNode.maiden_name;
  }

  // sex
  properties.gender = 'U';
  if (qNode.sex === 'M' || qNode.sex === 'F'){
    properties.gender = qNode.sex;
  } else if (qNode.tag.includes('father')){
    properties.gender = 'M';
  } else if (qNode.tag.includes('mother')){
    properties.gender = 'F';
  }

  // deceased
  if (qNode.deceased){
    properties.lifeStatus = 'deceased';
  }

  // dob
  // try to parse a full date, if we can't we need to add as a comment
  if ('dob' in qNode){
    const dobSplit = splitDate(qNode.dob);
    if (dobSplit){
      if ('day' in dobSplit){
        // we have a full date
        properties.dob = dobSplit.month + '/' + dobSplit.day + '/' + dobSplit.year;
      } else if ('month' in dobSplit){
        // we have a month and year
        comments.dob = 'b. ' + dobSplit.month + '-' + dobSplit.year;
      } else if ('year' in dobSplit){
        // we have a month and year
        comments.dob = 'b. ' + dobSplit.year;
      } else if ('age' in dobSplit){
        comments.dob = dobSplit.age;
      } else {
        comments.dob = qNode.dob;
      }
    } else {
      comments.dob = qNode.dob;
    }
  }

  // dod
  // try to parse a full date, if we can't we need to add as a comment
  if ('dod' in qNode){
    const dodSplit = splitDate(qNode.dod);

    const cd = ('cause_death' in qNode) ? (' ' + qNode.cause_death) : '';

    if (dodSplit){
      if ('day' in dodSplit){
        // we have a full date
        properties.dod = dodSplit.month + '/' + dodSplit.day + '/' + dodSplit.year;
        if (cd.length > 0){
          comments.dod = 'd. ' + dodSplit.month + '-' + dodSplit.year + cd;
        }
      } else if ('month' in dodSplit){
        // we have a month and year
        comments.dod = 'd. ' + dodSplit.month + '-' + dodSplit.year + cd;
      } else if ('year' in dodSplit){
        // we have a month and year
        comments.dod = 'd. ' + dodSplit.year + cd;
      } else if ('age' in dodSplit){
        comments.dod = 'd. ' + dodSplit.age + cd;
      } else {
        comments.dod = 'd. ' + qNode.dod + cd;
      }
    } else {
      comments.dod = 'd. ' + qNode.dod + cd;
    }
  } else if ('cause_death' in qNode){
    comments.dod = 'd. ' + qNode.cause_death;
  }

  if ('problem' in qNode){
    properties.disorders = qNode.problem;
  }

  if ('problem_age' in qNode){
    // problem age is associated with first problem
    comments.problem = qNode.problem[0] + ' dx ' + qNode.problem_age;
  }


  // cause_death
  // has_problem
  // parent
  // parent_tag
  // problem
  // problem_age
  // relationship
  // sibling_type

  let commentArray = [];
  for (const key of commentOrder) {
    if (key in comments) {
      commentArray.push(comments[key]);
    }
  }

  if (commentArray.length > 0){
    properties.comments = commentArray.join('\n');
  }
  // John Smith
  // 11.13.67 (or age)
  // Atrial fibrillation dx 23y
  // d. 43y
  return result;
};

QuestionnaireConverter.populateDistanceFromProband = function(node, distance){
  if (!node){
    return;
  }
  if ('dfp' in node && node.dfp <= distance){
    // already here
    return;
  }
  node.dfp = distance;
  const nextStep = distance + 1;
  if (node.mother){
    QuestionnaireConverter.populateDistanceFromProband(node.mother, nextStep);
  }
  if (node.father){
    QuestionnaireConverter.populateDistanceFromProband(node.mother, nextStep);
  }
  if (node.parents){
    for (let parentNode of node.parents){
      QuestionnaireConverter.populateDistanceFromProband(parentNode, nextStep);
    }
  }
  for (let childrenNode of node.children){
    QuestionnaireConverter.populateDistanceFromProband(childrenNode, nextStep);
  }
  for (let partnerNode of node.partners){
    QuestionnaireConverter.populateDistanceFromProband(partnerNode, nextStep);
  }
};

QuestionnaireConverter.buildConnectedCluster = function(node, nodesInCluster){
  if (nodesInCluster.has(node)){
    // already visited
    return;
  }
  nodesInCluster.add(node);
  if (node.mother){
    QuestionnaireConverter.buildConnectedCluster(node.mother, nodesInCluster);
  }
  if (node.father){
    QuestionnaireConverter.buildConnectedCluster(node.mother, nodesInCluster);
  }
  if (node.parents){
    for (let parentNode of node.parents){
      QuestionnaireConverter.buildConnectedCluster(parentNode, nodesInCluster);
    }
  }
  for (let childrenNode of node.children){
    QuestionnaireConverter.buildConnectedCluster(childrenNode, nodesInCluster);
  }
  for (let partnerNode of node.partners){
    QuestionnaireConverter.buildConnectedCluster(partnerNode, nodesInCluster);
  }

};

QuestionnaireConverter.findBestConnectInCluster = function(cluster){

  let clusterByTag = {};
  for (let node of cluster){
    let tag = node.qNode.tag;
    if (tag.startsWith('sibling_')){
      tag = 'sibling_';
    } else if (tag.startsWith('m_sibling_')){
      tag = 'm_sibling_';
    } else if (tag.startsWith('f_sibling_')){
      tag = 'f_sibling_';
    } else if (tag.startsWith('m_extended_')){
      tag = 'm_extended_';
    } else if (tag.startsWith('f_extended_')){
      tag = 'f_extended_';
    }
    if (tag in clusterByTag){
      clusterByTag[tag].push(node);
    } else {
      clusterByTag[tag] = [node];
    }
  }

  let stepsToProband = {
    'grandson': 2,
    'granddaughter': 2,
    'grandchild': 2,
    'great-grandson': 3,
    'great-granddaughter': 3,
    'great-grandchild': 3,
    'niece': 3,
    'nephew': 3,
    'grandniece': 4,
    'grandnephew': 4,
    'cousin': 4,
    'great-grandmother': 3,
    'great-grandfather': 3,
    'granduncle': 4,
    'grandaunt': 4,
  };

  let extended = undefined;

  if ('sibling_' in clusterByTag){
    return clusterByTag.sibling_[0];
  } else if ('m_mother' in clusterByTag){
    return clusterByTag.m_mother[0];
  } else if ('m_father' in clusterByTag){
    return clusterByTag.m_father[0];
  } else if ('f_mother' in clusterByTag){
    return clusterByTag.f_mother[0];
  } else if ('f_father' in clusterByTag){
    return clusterByTag.f_father[0];
  } else if ('m_sibling_' in clusterByTag){
    return clusterByTag.m_sibling_[0];
  } else if ('f_sibling_' in clusterByTag){
    return clusterByTag.f_sibling_[0];
  } else if ('m_extended_' in clusterByTag){
    extended = clusterByTag.m_extended_;
  } else if ('f_extended_' in clusterByTag) {
    extended = clusterByTag.f_extended_;
  } else {
    extended = [...cluster];
    console.log(extended);
  }
  if (extended.length == 1){
    // only one node anyway
    return extended[0];
  }

  extended.sort(function(a, b) {
    let aSteps = (a.qNode.relationship in stepsToProband) ? stepsToProband[a.qNode.relationship] : 5;
    let bSteps = (b.qNode.relationship in stepsToProband) ? stepsToProband[b.qNode.relationship] : 5;
    return bSteps - aSteps;
  });
  return extended[0];
};



function testNodeName(person, splitName, tag, node, masks, results, extendedRels){
  for (let mask of masks){
    if (tag.startsWith(mask)){

      if (person.qNode.parent === node.qNode.name){
        // names match
        results.push({ node: node, weighting: 20});
      } else {
        let weight = 0;
        if (node.splitName){
          if (splitName.first && node.splitName.first && splitName.first[0] === node.splitName.first[0]){
            weight += 2; // 2 for matching first name
          }
          if (splitName.surname && splitName.surname === node.splitName.surname){
            weight += 1; // 2 for matching first name
          }
          if (node.splitName.nickname && person.qNode.parent && person.qNode.parent === node.splitName.nickname){
            weight += 2; // 2 for matching first name
          }
        }
        if (splitName.surname && node.properties.lNameAtB && splitName.surname === node.properties.lNameAtB){
          weight += 1; // 2 for matching first name
        }
        if (extendedRels && (tag.startsWith('m_extended') || tag.startsWith('f_extended')) &&  extendedRels.includes(node.qNode.relationship)){
          // correct relationship
          weight += 2; // 2 for matching first name
        }
        results.push({ node: node, weighting: weight});
      }
      return;
    }
  }
}

function findExtendedParent(person, nodeByTag, genderOverride, parentMasks, grandparentMasks, parentRels, grandparentRels){

  if (genderOverride && person.properties.gender === 'U'){
    person.properties.gender = genderOverride;
  }
  // try and work out parent from name
  const splitName = person.qNode.parent ? NameSplitter.split(person.qNode.parent) : {};
  let possibleParentMatch = [];
  let possibleGrandParentMatch = [];

  // go through parent masks
  for (let tagKey in nodeByTag) {
    let possibleParent = nodeByTag[tagKey];
    testNodeName(person, splitName, tagKey, possibleParent, parentMasks, possibleParentMatch, parentRels);
    testNodeName(person, splitName, tagKey, possibleParent, grandparentMasks, possibleGrandParentMatch, grandparentRels);
  }
  possibleParentMatch.sort((a, b) => b.weighting - a.weighting);
  possibleGrandParentMatch.sort((a, b) => b.weighting - a.weighting);

  let parentNode = undefined;
  let grandparentNode = undefined;
  if (possibleParentMatch.length > 0 && possibleGrandParentMatch > 0) {
    if (possibleParentMatch[0].weighting >= possibleGrandParentMatch[0].weighting) {
      parentNode = possibleParentMatch[0].node;
    } else {
      grandparentNode = possibleGrandParentMatch[0].node;
    }
  } else if (possibleParentMatch.length > 0){
    parentNode = possibleParentMatch[0].node;
  } else if (possibleGrandParentMatch > 0) {
    grandparentNode = possibleGrandParentMatch[0].node;
  }
  if (parentNode){
    if (parentNode.properties.gender === 'M'){
      person.father = parentNode;
    } else if (parentNode.properties.gender === 'F'){
      person.mother = parentNode;
    } else if ('parents' in person) {
      person.parents.push(parentNode);
    } else {
      person.parents = [parentNode];
    }
  } else if (grandparentNode){
    if ('grandparents' in person) {
      person.grandparents.push(grandparentNode);
    } else {
      person.grandparents = [grandparentNode];
    }
  }
}

function findExtendedByRelationship(nodeByTag, extendedType, rels){
  let matches = [];
  for (let tagKey in nodeByTag){
    if (tagKey.startsWith(extendedType)){
      let rel = nodeByTag[tagKey].qNode.relationship;
      if (rels.includes(rel)){
        matches.push(nodeByTag[tagKey]);
      }
    }
  }
  return matches;
}

function processGrandParent(gran, pa, greatGrandparent, parentAttrib){
  if (greatGrandparent.children.has(gran) || greatGrandparent.children.has(pa)){
    return;
  }
  // try to find best match out of two grandparents
  // first check if the parent name on the extended record matches.
  if ('parent' in greatGrandparent.qNode){
    if (greatGrandparent.qNode.parent && greatGrandparent.qNode.parent === gran.qNode.name){
      gran[parentAttrib] = greatGrandparent;
      greatGrandparent.children.add(gran);
      return;
    }else if (greatGrandparent.qNode.parent && greatGrandparent.qNode.parent === pa.qNode.name){
      pa[parentAttrib] = greatGrandparent;
      greatGrandparent.children.add(pa);
      return;
    }else if (greatGrandparent.qNode.parent && gran.splitName.first && gran.splitName.first.length > 0
              && greatGrandparent.qNode.parent === gran.splitName.first[0]){
      gran[parentAttrib] = greatGrandparent;
      greatGrandparent.children.add(gran);
      return;
    }else if (greatGrandparent.qNode.parent && pa.splitName.first && pa.splitName.first.length > 0
              && greatGrandparent.qNode.parent === pa.splitName.first[0]){
      pa[parentAttrib] = greatGrandparent;
      greatGrandparent.children.add(pa);
      return;
    }
  }
  let ggNameSplit = greatGrandparent.splitName ? greatGrandparent.splitName : {};
  if (ggNameSplit.surname && ggNameSplit.surname === gran.qNode.maiden_name){
    // matches maiden name
    gran[parentAttrib] = greatGrandparent;
    greatGrandparent.children.add(gran);
  } else if (ggNameSplit.surname && ggNameSplit.surname === pa.splitName.surname){
    pa[parentAttrib] = greatGrandparent;
    greatGrandparent.children.add(pa);
  } else if (ggNameSplit.surname && ggNameSplit.surname === gran.splitName.surname){
    gran[parentAttrib] = greatGrandparent;
    greatGrandparent.children.add(gran);
  }
}

function findGreatGrandparents(person, nodeByTag, extendedType, gran, pa){
  if (!('mother' in person || 'father' in person || 'parents' in person)){
    let greatGrandmothers = findExtendedByRelationship(nodeByTag, extendedType, ['great-grandmother']);
    let greatGrandfathers = findExtendedByRelationship(nodeByTag, extendedType, ['great-grandfather']);

    for (let greatGran of greatGrandmothers){
      processGrandParent(gran, pa, greatGran, 'mother');
    }
    for (let greatPa of greatGrandfathers){
      processGrandParent(gran, pa, greatPa, 'father');
    }
  }

}

QuestionnaireConverter.addParents = function(person, nodeByTag){
  const tag = person.qNode.tag;
  if ('proband' === tag){
    if ('mother' in nodeByTag){
      person.mother = nodeByTag.mother;
    }
    if ('father' in nodeByTag){
      person.father = nodeByTag.father;
    }
  } else if ('mother' === tag){
    if ('m_mother' in nodeByTag){
      person.mother = nodeByTag.m_mother;
    }
    if ('m_father' in nodeByTag){
      person.father = nodeByTag.m_father;
    }
  } else if ('father' === tag){
    if ('f_mother' in nodeByTag){
      person.mother = nodeByTag.f_mother;
    }
    if ('f_father' in nodeByTag){
      person.father = nodeByTag.f_father;
    }
  } else if ('m_mother' === tag || 'm_father' === tag){
    findGreatGrandparents(person, nodeByTag, 'm_extended', nodeByTag.m_mother, nodeByTag.m_father);
  } else if ('f_mother' === tag || 'f_father' === tag){
    findGreatGrandparents(person, nodeByTag, 'f_extended', nodeByTag.f_mother, nodeByTag.f_father);
  } else if (tag.startsWith('child_')){
    let probandIsMother = true;
    if (nodeByTag.proband.properties.gender === 'M'){
      person.father = nodeByTag.proband;
      probandIsMother = false;
    } else {
      person.mother = nodeByTag.proband;
    }
    if (person.qNode.parent_tag in nodeByTag){
      if (probandIsMother){
        person.father = nodeByTag[person.qNode.parent_tag];
      } else {
        person.mother = nodeByTag[person.qNode.parent_tag];
      }
    } else if ('partner_1' in nodeByTag){
      // default to first partner if not specified
      if (probandIsMother){
        person.father = nodeByTag['partner_1'];
      } else {
        person.mother = nodeByTag['partner_1'];
      }
    }
  } else if (tag.startsWith('partner_')){
    if (nodeByTag.proband.properties.gender === 'M'){
      person.properties.gender = 'F';
    } else if (nodeByTag.proband.properties.gender === 'F'){
      person.properties.gender = 'M';
    }
  } else if (tag.startsWith('sibling_')){
    if (person.qNode.sibling_type === 'full'){
      if ('mother' in nodeByTag){
        person.mother = nodeByTag.mother;
      }
      if ('father' in nodeByTag){
        person.father = nodeByTag.father;
      }
    } else if (person.qNode.sibling_type === 'mat'){
      if ('mother' in nodeByTag){
        person.mother = nodeByTag.mother;
      }
    } else if (person.qNode.sibling_type === 'pat'){
      if ('father' in nodeByTag){
        person.father = nodeByTag.father;
      }
    // } else if (person.qNode.sibling_type !== 'other'){
    } else {
      // default to full
      if ('mother' in nodeByTag){
        person.mother = nodeByTag.mother;
      }
      if ('father' in nodeByTag){
        person.father = nodeByTag.father;
      }
    }

  } else if (tag.startsWith('m_sibling_')){
    if (person.qNode.sibling_type === 'full'){
      if ('m_mother' in nodeByTag){
        person.mother = nodeByTag.m_mother;
      }
      if ('m_father' in nodeByTag){
        person.father = nodeByTag.m_father;
      }
    } else if (person.qNode.sibling_type === 'mat'){
      if ('m_mother' in nodeByTag){
        person.mother = nodeByTag.m_mother;
      }
    } else if (person.qNode.sibling_type === 'pat'){
      if ('m_father' in nodeByTag){
        person.father = nodeByTag.m_father;
      }
    // } else if (person.qNode.sibling_type !== 'other'){
    } else {
      // default to full
      if ('m_mother' in nodeByTag){
        person.mother = nodeByTag.m_mother;
      }
      if ('m_father' in nodeByTag){
        person.father = nodeByTag.m_father;
      }
    }
  } else if (tag.startsWith('f_sibling_')){
    if (person.qNode.sibling_type === 'full'){
      if ('f_mother' in nodeByTag){
        person.mother = nodeByTag.f_mother;
      }
      if ('f_father' in nodeByTag){
        person.father = nodeByTag.f_father;
      }
    } else if (person.qNode.sibling_type === 'mat'){
      if ('f_mother' in nodeByTag){
        person.mother = nodeByTag.f_mother;
      }
    } else if (person.qNode.sibling_type === 'pat'){
      if ('f_father' in nodeByTag){
        person.father = nodeByTag.f_father;
      }
    // } else if (person.qNode.sibling_type !== 'other'){
    } else {
      // default to full
      if ('f_mother' in nodeByTag){
        person.mother = nodeByTag.f_mother;
      }
      if ('f_father' in nodeByTag){
        person.father = nodeByTag.f_father;
      }
    }
  } else if (tag.startsWith('m_extended_')){
    let genderOverride = undefined;
    let parentMasks = [];
    let parentRels = [];
    let grandparentMasks = [];
    let grandparentRels = [];
    if ('relationship' in person.qNode){
      switch(person.qNode.relationship){
      case 'grandson':
        genderOverride = 'M';
        parentMasks.push('child_');
        grandparentMasks.push('proband');
        grandparentMasks.push('partner_');
        break;
      case 'granddaughter':
        genderOverride = 'F';
        parentMasks.push('child_');
        grandparentMasks.push('proband');
        grandparentMasks.push('partner_');
        break;
      case 'grandchild':
        parentMasks.push('child_');
        grandparentMasks.push('proband');
        grandparentMasks.push('partner_');
        break;
      case 'great-grandson':
        genderOverride = 'M';
        parentMasks.push('m_extended_');
        parentMasks.push('f_extended_');
        parentRels.push('grandson');
        parentRels.push('granddaughter');
        parentRels.push('grandchild');
        grandparentMasks.push('child_');
        break;
      case 'great-granddaughter':
        genderOverride = 'F';
        parentMasks.push('m_extended_');
        parentMasks.push('f_extended_');
        parentRels.push('grandson');
        parentRels.push('granddaughter');
        parentRels.push('grandchild');
        grandparentMasks.push('child_');
        break;
      case 'great-grandchild':
        parentMasks.push('m_extended_');
        parentMasks.push('f_extended_');
        parentRels.push('grandson');
        parentRels.push('granddaughter');
        parentRels.push('grandchild');
        grandparentMasks.push('child_');
        break;
      case 'niece':
        genderOverride = 'F';
        parentMasks.push('sibling_');
        grandparentMasks.push('mother');
        grandparentMasks.push('father');
        break;
      case 'nephew':
        genderOverride = 'M';
        parentMasks.push('sibling_');
        grandparentMasks.push('mother');
        grandparentMasks.push('father');
        break;
      case 'grandniece':
        genderOverride = 'F';
        parentMasks.push('m_extended_');
        parentRels.push('niece');
        parentRels.push('nephew');
        grandparentMasks.push('sibling_');
        break;
      case 'grandnephew':
        genderOverride = 'M';
        parentMasks.push('m_extended_');
        parentRels.push('niece');
        parentRels.push('nephew');
        grandparentMasks.push('sibling_');
        break;
      case 'cousin':
        parentMasks.push('m_sibling_');
        grandparentMasks.push('m_mother_');
        grandparentMasks.push('m_father_');
        break;
      case 'great-grandmother':
        genderOverride = 'F';
        break;
      case 'great-grandfather':
        genderOverride = 'M';
        break;
      case 'granduncle':
        genderOverride = 'M';
        parentMasks.push('m_extended_');
        parentRels.push('great-grandmother');
        parentRels.push('great-grandfather');
        grandparentMasks.push('m_extended_');
        break;
      case 'grandaunt':
        genderOverride = 'F';
        parentMasks.push('m_extended_');
        parentRels.push('great-grandmother');
        parentRels.push('great-grandfather');
        grandparentMasks.push('m_extended_');
        break;
      }
    } else if ('parent' in person){
      parentMasks.push('child_', 'sibling', 'm_sibling_', 'm_extended_');
    }
    findExtendedParent(person, nodeByTag, genderOverride, parentMasks, grandparentMasks, parentRels, grandparentRels);
  } else if (tag.startsWith('f_extended_')){
    let genderOverride = undefined;
    let parentMasks = [];
    let parentRels = [];
    let grandparentMasks = [];
    let grandparentRels = [];
    if ('relationship' in person.qNode){
      switch(person.qNode.relationship){
      case 'grandson':
        genderOverride = 'M';
        parentMasks.push('child_');
        grandparentMasks.push('proband');
        grandparentMasks.push('partner_');
        break;
      case 'granddaughter':
        genderOverride = 'F';
        parentMasks.push('child_');
        grandparentMasks.push('proband');
        grandparentMasks.push('partner_');
        break;
      case 'grandchild':
        parentMasks.push('child_');
        grandparentMasks.push('proband');
        grandparentMasks.push('partner_');
        break;
      case 'great-grandson':
        genderOverride = 'M';
        parentMasks.push('m_extended_');
        parentMasks.push('f_extended_');
        parentRels.push('grandson');
        parentRels.push('granddaughter');
        parentRels.push('grandchild');
        grandparentMasks.push('child_');
        break;
      case 'great-granddaughter':
        genderOverride = 'F';
        parentMasks.push('m_extended_');
        parentMasks.push('f_extended_');
        parentRels.push('grandson');
        parentRels.push('granddaughter');
        parentRels.push('grandchild');
        grandparentMasks.push('child_');
        break;
      case 'great-grandchild':
        parentMasks.push('m_extended_');
        parentMasks.push('f_extended_');
        parentRels.push('grandson');
        parentRels.push('granddaughter');
        parentRels.push('grandchild');
        grandparentMasks.push('child_');
        break;
      case 'niece':
        genderOverride = 'F';
        parentMasks.push('sibling_');
        grandparentMasks.push('mother');
        grandparentMasks.push('father');
        break;
      case 'nephew':
        genderOverride = 'M';
        parentMasks.push('sibling_');
        grandparentMasks.push('mother');
        grandparentMasks.push('father');
        break;
      case 'grandniece':
        genderOverride = 'F';
        parentMasks.push('f_extended_');
        parentRels.push('niece');
        parentRels.push('nephew');
        grandparentMasks.push('sibling_');
        break;
      case 'grandnephew':
        genderOverride = 'M';
        parentMasks.push('f_extended_');
        parentRels.push('niece');
        parentRels.push('nephew');
        grandparentMasks.push('sibling_');
        break;
      case 'cousin':
        parentMasks.push('f_sibling_');
        grandparentMasks.push('f_mother_');
        grandparentMasks.push('f_father_');
        break;
      case 'great-grandmother':
        genderOverride = 'F';
        break;
      case 'great-grandfather':
        genderOverride = 'M';
        break;
      case 'grandaunt':
        genderOverride = 'F';
        parentMasks.push('f_extended_');
        parentRels.push('great-grandmother');
        parentRels.push('great-grandmfather');
        grandparentMasks.push('f_extended_');
        break;
      case 'granduncle':
        genderOverride = 'M';
        parentMasks.push('f_extended_');
        parentRels.push('great-grandmother');
        parentRels.push('great-grandmfather');
        grandparentMasks.push('f_extended_');
        break;
      }
    } else if ('parent' in person){
      parentMasks.push('child_', 'sibling', 'f_sibling_', 'f_extended_');
    }
    findExtendedParent(person, nodeByTag, genderOverride, parentMasks, grandparentMasks, parentRels, grandparentRels);
  }
  // add children and partners
  if (person.mother) {
    person.mother.children.add(person);
  }
  if (person.father) {
    person.father.children.add(person);
  }
  if (person.mother && person.father) {
    person.mother.partners.add(person.father);
    person.father.partners.add(person.mother);
  }
  if (person.parents) {
    if (person.parents.length === 1) {
      person.parents[0].children.add(person);
    } else if (person.parents.length === 2) {
      person.parents[0].children.add(person);
      person.parents[1].children.add(person);
      person.parents[0].partners.add(person.parents[1]);
      person.parents[1].partners.add(person.parents[0]);
    }
  }

};

function getNextId(mask, nodes, fakeNodes){
  let i=1;
  let nextId = mask + i;
  while (nextId in nodes || nextId in false){
    i++;
    nextId = mask + i;
  }
  return nextId;
}

function hasExtended(nodeByTag, fakeNodes, extendedType, rels){
  for (let tagKey in nodeByTag){
    if (tagKey.startsWith(extendedType)){
      let rel = nodeByTag[tagKey].qNode.relationship;
      if (rels.includes(rel)){
        return true;
      }
    }
  }
  for (let tagKey in fakeNodes){
    if (tagKey.startsWith(extendedType)){
      let rel = fakeNodes[tagKey].qNode.relationship;
      if (rels.includes(rel)){
        return true;
      }
    }
  }
  return false;
}


QuestionnaireConverter.addMissingNodes = function(person, nodeByTag, fakeNodes, badNodes){

  const tag = person.qNode.tag;
  if ('proband' === tag){
    // only possible if proband is only person
  } else if ('mother' === tag){
    // should not be possible
  } else if ('father' === tag){
    // should not be possible
  } else if ('m_mother' === tag){
    // means we are missing mother
    if (!('mother' in fakeNodes)){
      console.log('adding fake mother due to m_mother not connected');
      fakeNodes.mother = { qNode: { tag: 'mother'}, properties: {id: 'mother', gender: 'F'}, children: new Set(), partners: new Set()};
    }
  } else if ('m_father' === tag){
    // means we are missing mother
    if (!('mother' in fakeNodes)){
      console.log('adding fake mother due to m_father not connected');
      fakeNodes.mother = { qNode: { tag: 'mother'}, properties: {id: 'mother', gender: 'F'}, children: new Set(), partners: new Set()};
    }
  } else if ('f_mother' === tag){
    // means we are missing father
    if (!('father' in fakeNodes)){
      console.log('adding fake father due to f_mother not connected');
      fakeNodes.father = { qNode: { tag: 'father'}, properties: {id: 'father', gender: 'M'}, children: new Set(), partners: new Set()};
    }
  } else if ('f_father' === tag){
    // means we are missing father
    if (!('father' in fakeNodes)){
      console.log('adding fake father due to f_father not connected');
      fakeNodes.father = { qNode: { tag: 'father'}, properties: {id: 'father', gender: 'M'}, children: new Set(), partners: new Set()};
    }
  } else if (tag.startsWith('child_')){
    // should not be possible
  } else if (tag.startsWith('partner_')){
    // should not be possible
  } else if (tag.startsWith('sibling_')){
    // means we are missing mother and father
    if (!('mother' in fakeNodes)){
      console.log('adding fake mother due to sibling not connected');
      fakeNodes.mother = { qNode: { tag: 'mother'}, properties: {id: 'mother', gender: 'F'}, children: new Set(), partners: new Set()};
    }
    if (!('father' in fakeNodes)){
      console.log('adding fake father due to sibling not connected');
      fakeNodes.father = { qNode: { tag: 'father'}, properties: {id: 'father', gender: 'M'}, children: new Set(), partners: new Set()};
    }
  } else if (tag.startsWith('m_sibling_')){
    // means we are missing m_mother and m_father
    if (!('m_mother' in fakeNodes)){
      console.log('adding fake m_mother due to m_sibling not connected');
      fakeNodes.m_mother = { qNode: { tag: 'm_mother'}, properties: {id: 'm_mother', gender: 'F'}, children: new Set(), partners: new Set()};
    }
    if (!('m_father' in fakeNodes)){
      console.log('adding fake m_father due to m_sibling not connected');
      fakeNodes.m_father = { qNode: { tag: 'm_father'}, properties: {id: 'm_father', gender: 'M'}, children: new Set(), partners: new Set()};
    }
  } else if (tag.startsWith('f_sibling_')){
    // means we are missing f_mother and f_father
    if (!('f_mother' in fakeNodes)){
      console.log('adding fake f_mother due to f_sibling not connected');
      fakeNodes.f_mother = { qNode: { tag: 'f_mother'}, properties: {id: 'f_mother', gender: 'F'}, children: new Set(), partners: new Set()};
    }
    if (!('f_father' in fakeNodes)){
      console.log('adding fake f_father due to f_sibling not connected');
      fakeNodes.f_father = { qNode: { tag: 'f_father'}, properties: {id: 'm_father', gender: 'M'}, children: new Set(), partners: new Set()};
    }
  } else if (tag.startsWith('m_extended_')){
    let fakeTag = undefined;
    if ('relationship' in person.qNode){
      switch(person.qNode.relationship){
      case 'grandson':
      case 'granddaughter':
      case 'grandchild':
        // means we are missing child
        console.log('adding fake child_1 due to m_extended grandchild not connected');
        fakeNodes.child_1 = { qNode: { tag: 'child_1'}, properties: {id: 'child_1', gender: 'U'}, children: new Set(), partners: new Set()};
        break;
      case 'great-grandson':
      case 'great-granddaughter':
      case 'great-grandchild':
        // means we are missing grandchild
        console.log('adding fake m_extended grandchild due to m_extended great-grandchild not connected');
        fakeTag = getNextId('m_extended_', nodeByTag, fakeNodes);
        fakeNodes[fakeTag] = { qNode: { tag: fakeTag, relationship: 'grandchild'}, properties: {id: fakeTag, gender: 'U'}, children: new Set(), partners: new Set()};
        // deal with missing child
        QuestionnaireConverter.addMissingNodes(fakeNodes[fakeTag], nodeByTag, fakeNodes);
        break;
      case 'niece':
      case 'nephew':
        // means we are missing sibling
        console.log('adding fake sibling_1 due to m_extended niece/nephew not connected');
        fakeNodes.sibling_1 = { qNode: { tag: 'sibling_1'}, properties: {id: 'sibling_1', gender: 'U'}, children: new Set(), partners: new Set()};
        if (!('mother' in nodeByTag || 'father' in nodeByTag || 'mother' in fakeNodes || 'father' in fakeNodes )) {
          QuestionnaireConverter.addMissingNodes(fakeNodes.sibling_1, nodeByTag, fakeNodes);
        }
        break;
      case 'grandniece':
      case 'grandnephew':
        // means we are missing niece or nephew
        console.log('adding fake m_extended niece due to m_extended grandniece/grandnephew not connected');
        fakeTag = getNextId('m_extended_', nodeByTag, fakeNodes);
        fakeNodes[fakeTag] = { qNode: { tag: fakeTag, relationship: 'niece'}, properties: {id: fakeTag, gender: 'U'}, children: new Set(), partners: new Set()};
        // deal with missing sibling
        QuestionnaireConverter.addMissingNodes(fakeNodes[fakeTag], nodeByTag, fakeNodes);
        break;
      case 'cousin':
        // means we are missing m_sibling
        console.log('adding fake m_sibling_1 due to m_extended cousin not connected');
        fakeNodes.m_sibling_1 = { qNode: { tag: 'm_sibling_1'}, properties: {id: 'm_sibling_1', gender: 'U'}, children: new Set(), partners: new Set()};
        if (!(hasExtended(nodeByTag, fakeNodes, 'm_extended_', ['great-grandmother', 'great-grandfather']))) {
          QuestionnaireConverter.addMissingNodes(fakeNodes.sibling_1, nodeByTag, fakeNodes);
        }
        break;
      case 'great-grandmother':
      case 'great-grandfather':
        // means we are missing grandparent
        if (!('m_mother' in fakeNodes)){
          console.log('adding fake m_mother due to m_extended great-grandparent not connected');
          fakeNodes.m_mother = { qNode: { tag: 'm_mother'}, properties: {id: 'm_mother', gender: 'F'}, children: new Set(), partners: new Set()};
          if (!('mother' in nodeByTag || 'mother' in fakeNodes )) {
            QuestionnaireConverter.addMissingNodes(fakeNodes.m_mother, nodeByTag, fakeNodes);
          }
        }
        if (!('m_father' in fakeNodes)){
          console.log('adding fake m_father due to m_extended great-grandparent not connected');
          fakeNodes.m_father = { qNode: { tag: 'm_father'}, properties: {id: 'm_father', gender: 'M'}};
          if (!('mother' in nodeByTag || 'mother' in fakeNodes )) {
            QuestionnaireConverter.addMissingNodes(fakeNodes.m_mother, nodeByTag, fakeNodes);
          }
        }
        break;
      case 'granduncle':
      case 'grandaunt':
        // means we are missing great grandparent
        console.log('adding fake m_extended great-grandmother due to m_extended granduncle/grandaunt not connected');
        fakeTag = getNextId('m_extended_', nodeByTag, fakeNodes);
        fakeNodes.fakeTag = { qNode: { tag: fakeTag, relationship: 'great-grandmother'}, properties: {id: fakeTag, gender: 'U'}, children: new Set(), partners: new Set()};
        if (!('m_mother' in nodeByTag || 'm_father' in nodeByTag || 'm_mother' in fakeNodes || 'm_father' in fakeNodes)) {
          QuestionnaireConverter.addMissingNodes(fakeNodes.sibling_1, nodeByTag, fakeNodes);
        }
        break;
      }
    } else {
      console.log('adding node to bad nodes', person);
      badNodes.push(person);
    }
  } else if (tag.startsWith('f_extended_')) {
    let fakeTag = undefined;
    if ('relationship' in person.qNode) {
      switch (person.qNode.relationship) {
      case 'grandson':
      case 'granddaughter':
      case 'grandchild':
        // means we are missing child
        console.log('adding fake child_1 due to f_extended grandchild not connected');
        fakeNodes.child_1 = {qNode: {tag: 'child_1'}, properties: {id: 'child_1', gender: 'U'}, children: new Set(), partners: new Set()};
        break;
      case 'great-grandson':
      case 'great-granddaughter':
      case 'great-grandchild':
        // means we are missing grandchild
        console.log('adding fake f_extended grandchild due to f_extended great-grandchild not connected');
        fakeTag = getNextId('f_extended_', nodeByTag, fakeNodes);
        fakeNodes[fakeTag] = {qNode: {tag: fakeTag, relationship: 'grandchild'}, properties: {id: fakeTag, gender: 'U'}, children: new Set(), partners: new Set()};
        // deal with missing child
        QuestionnaireConverter.addMissingNodes(fakeNodes[fakeTag], nodeByTag, fakeNodes);
        break;
      case 'niece':
      case 'nephew':
        // means we are missing sibling
        console.log('adding fake sibling_1 due to f_extended niece/nephew not connected');
        fakeNodes.sibling_1 = {qNode: {tag: 'sibling_1'}, properties: {id: 'sibling_1', gender: 'U'}, children: new Set(), partners: new Set()};
        if (!('mother' in nodeByTag || 'father' in nodeByTag || 'mother' in fakeNodes || 'father' in fakeNodes )) {
          QuestionnaireConverter.addMissingNodes(fakeNodes.sibling_1, nodeByTag, fakeNodes);
        }
        break;
      case 'grandniece':
      case 'grandnephew':
        // means we are missing niece or nephew
        console.log('adding fake f_extended niece due to f_extended grandniece/grandnephew not connected');
        fakeTag = getNextId('f_extended_', nodeByTag, fakeNodes);
        fakeNodes[fakeTag] = {qNode: {tag: fakeTag, relationship: 'niece'}, properties: {id: fakeTag, gender: 'U'}, children: new Set(), partners: new Set()};
        // deal with missing sibling
        QuestionnaireConverter.addMissingNodes(fakeNodes[fakeTag], nodeByTag, fakeNodes);
        break;
      case 'cousin':
        // means we are missing m_sibling
        console.log('adding fake f_sibling_1 niece due to f_extended cousin not connected');
        fakeNodes.f_sibling_1 = {qNode: {tag: 'f_sibling_1'}, properties: {id: 'f_sibling_1', gender: 'U'}, children: new Set(), partners: new Set()};
        if (!(hasExtended(nodeByTag, fakeNodes, 'f_extended_', ['great-grandmother', 'great-grandfather']))) {
          QuestionnaireConverter.addMissingNodes(fakeNodes.sibling_1, nodeByTag, fakeNodes);
        }
        break;
      case 'great-grandmother':
      case 'great-grandfather':
        // means we are missing grandparent
        if (!('f_mother' in fakeNodes)) {
          console.log('adding fake f_mother due to f_extended great-grandparent not connected');
          fakeNodes.f_mother = {qNode: {tag: 'f_mother'}, properties: {id: 'f_mother', gender: 'F'}, children: new Set(), partners: new Set()};
          if (!('father' in nodeByTag || 'father' in fakeNodes )) {
            QuestionnaireConverter.addMissingNodes(fakeNodes.m_mother, nodeByTag, fakeNodes);
          }
        }
        if (!('f_father' in fakeNodes)) {
          console.log('adding fake f_father due to f_extended great-grandparent not connected');
          fakeNodes.f_father = {qNode: {tag: 'f_father'}, properties: {id: 'f_father', gender: 'M'}, children: new Set(), partners: new Set()};
          if (!('father' in nodeByTag || 'father' in fakeNodes )) {
            QuestionnaireConverter.addMissingNodes(fakeNodes.m_mother, nodeByTag, fakeNodes);
          }
        }
        break;
      case 'granduncle':
      case 'grandaunt':
        // means we are missing great grandparent
        console.log('adding fake f_extended great-grandmother due to f_extended granduncle/grandaunt not connected');
        fakeTag = getNextId('f_extended_', nodeByTag, fakeNodes);
        fakeNodes.fakeTag = {qNode: {tag: fakeTag, relationship: 'great-grandmother'}, properties: {id: fakeTag, gender: 'U'}, children: new Set([person]), partners: new Set()};
        if (!('m_mother' in nodeByTag || 'm_father' in nodeByTag || 'm_mother' in fakeNodes || 'm_father' in fakeNodes)) {
          QuestionnaireConverter.addMissingNodes(fakeNodes.sibling_1, nodeByTag, fakeNodes);
        }
        break;
      }

    } else {
      badNodes.push(person);
    }
  }

};

function setParentOfExtended(nodeByTag, parent, targetMask, rels){
  let key = undefined;
  let value = undefined;
  if (parent.properties.gender === 'M'){
    key = 'father';
    value = parent;
  } else if (parent.properties.gender === 'F'){
    key = 'father';
    value = parent;
  } else {
    key = 'parents';
    value = [parent];
  }
  for (let tag in nodeByTag){
    if (tag.startsWith(targetMask)){
      let node = nodeByTag[tag];
      let rel = node.qNode.relationship;
      for (var r of rels){
        if (rel === r){
          if (!(key in node)){
            node[key] = value;
          }
        }
      }
    }
  }
}

QuestionnaireConverter.connectFakeNode = function(person, nodeByTag){

  const tag = person.qNode.tag;
  if ('proband' === tag){
    // should not be possible
  } else if (tag.startsWith('partner_')){
    // should not be possible
  } else if (tag.startsWith('child_')){
    // this will happen if an extended is a grandchild
    let addPartner = ('partner_1' in nodeByTag);
    if (nodeByTag.proband.properties.gender === 'M'){
      person.father = nodeByTag.proband;
      if (addPartner) {
        person.mother = nodeByTag.partner_1;
      }
    } else if (nodeByTag.proband.properties.gender === 'F'){
      person.mother = nodeByTag.proband;
      if (addPartner) {
        person.father = nodeByTag.partner_1;
      }
    } else {
      person.parents = (addPartner) ? [nodeByTag.proband, nodeByTag.partner_1] : [nodeByTag.proband];
    }
    // set parent for any grandchild
    for (const nodeTag in nodeByTag){
      if (nodeTag.startsWith('m_extended_') || nodeTag.startsWith('f_extended_')){
        let grandchild = nodeByTag[nodeTag];
        const rel = grandchild.qNode.relationship;
        if ('grandson' === rel || 'granddaughter' === rel || 'granschild' === rel){
          if (person.gender === 'M'){
            grandchild.father = person;
          } else if (person.gender === 'F') {
            grandchild.mother = person;
          } else {
            grandchild.parents = [person];
          }
        }
      }
    }

  } else if (tag.startsWith('sibling_')){
    // this will happen if an extended is a niece or nephew
    // set parent for any grandchild
    let connect_m = false;
    let connect_f = false;
    for (const nodeTag in nodeByTag){
      if (nodeTag.startsWith('m_extended_') || nodeTag.startsWith('f_extended_')) {
        let child = nodeByTag[nodeTag];
        const rel = child.qNode.relationship;
        if ('niece' === rel || 'nephew' === rel){
          if (person.gender === 'M'){
            child.father = person;
          } else if (person.gender === 'F') {
            child.mother = person;
          } else {
            child.parents = [person];
          }
          if (nodeTag.startsWith('m')){
            connect_m = true;
          } else {
            connect_f = true;
          }
        }
      }
    }
    if (connect_f && 'father' in nodeByTag){
      person.father = nodeByTag.father;
    }
    if (connect_m && 'mother' in nodeByTag){
      person.mother = nodeByTag.mother;
    }
  } else if ('mother' === tag){
    // this can happen if we get a sibling but no parents or grandparents.
    for (const nodeTag in nodeByTag){
      let node = nodeByTag[nodeTag];
      if (nodeTag === 'proband'){
        node.mother = person;
      } else if (nodeTag.startsWith('sibling_')){
        if (node.qNode.sibling_type !== 'pat'){
          node.mother = person;
        }
      } else if (nodeTag === 'm_mother'){
        person.mother = node;
      } else if (nodeTag === 'm_father'){
        person.father = node;
      }
    }
  } else if ('father' === tag){
    // this can happen if we get a sibling but no parents or grandparents.
    for (const nodeTag in nodeByTag){
      let node = nodeByTag[nodeTag];
      if (nodeTag === 'proband'){
        node.father = person;
      } else if (nodeTag.startsWith('sibling_')){
        if (node.qNode.sibling_type !== 'mat'){
          node.father = person;
        }
      } else if (nodeTag === 'f_mother'){
        person.mother = node;
      } else if (nodeTag === 'f_father'){
        person.father = node;
      }
    }
  } else if ('m_mother' === tag){
    // this can happen if we get an aunt or uncle, or a great-grandparent
    for (const nodeTag in nodeByTag){
      let node = nodeByTag[nodeTag];
      if (nodeTag === 'mother'){
        node.mother = person;
      } else if (nodeTag.startsWith('m_sibling_')){
        if (node.qNode.sibling_type !== 'pat'){
          node.mother = person;
        }
      } else if (nodeTag.startsWith('m_extended_')){
        const rel = node.qNode.relationship;
        if ('aunt' === rel || 'uncle' === rel){
          // aunt and uncles should be m_sibling or f_sibling
          node.mother = person;
        } else if ('great-grandmother' === rel){
          person.mother = node;
        }else if ('great-grandfather' === rel){
          person.father = node;
        }
      }
    }
  } else if ('f_mother' === tag){
    // this can happen if we get an aunt or uncle, or a great-grandparent
    for (const nodeTag in nodeByTag){
      let node = nodeByTag[nodeTag];
      if (nodeTag === 'father'){
        node.mother = person;
      } else if (nodeTag.startsWith('f_sibling_')){
        if (node.qNode.sibling_type !== 'pat'){
          node.mother = person;
        }
      } else if (nodeTag.startsWith('f_extended_')){
        const rel = node.qNode.relationship;
        if ('aunt' === rel || 'uncle' === rel){
          // aunt and uncles should be m_sibling or f_sibling
          node.mother = person;
        } else if ('great-grandmother' === rel){
          person.mother = node;
        }else if ('great-grandfather' === rel){
          person.father = node;
        }
      }
    }
  } else if ('m_father' === tag){
    // this can happen if we get an aunt or uncle, or a great-grandparent
    for (const nodeTag in nodeByTag){
      let node = nodeByTag[nodeTag];
      if (nodeTag === 'mother'){
        node.father = person;
      } else if (nodeTag.startsWith('m_sibling_')){
        if (node.qNode.sibling_type !== 'pat'){
          node.father = person;
        }
      } else if (nodeTag.startsWith('m_extended_')){
        const rel = node.qNode.relationship;
        if ('aunt' === rel || 'uncle' === rel){
          // aunt and uncles should be m_sibling or f_sibling
          node.father = person;
        } else if ('great-grandmother' === rel){
          person.mother = node;
        }else if ('great-grandfather' === rel){
          person.father = node;
        }
      }
    }
  } else if ('f_father' === tag){
    // this can happen if we get an aunt or uncle, or a great-grandparent
    for (const nodeTag in nodeByTag){
      let node = nodeByTag[nodeTag];
      if (nodeTag === 'father'){
        node.father = person;
      } else if (nodeTag.startsWith('f_sibling_')){
        if (node.qNode.sibling_type !== 'pat'){
          node.father = person;
        }
      } else if (nodeTag.startsWith('f_extended_')){
        const rel = node.qNode.relationship;
        if ('aunt' === rel || 'uncle' === rel){
          // aunt and uncles should be m_sibling or f_sibling
          node.father = person;
        } else if ('great-grandmother' === rel){
          person.mother = node;
        }else if ('great-grandfather' === rel){
          person.father = node;
        }
      }
    }
  } else if (tag.startsWith('m_sibling_')){
    // this can happen if we get a cousin
    for (const nodeTag in nodeByTag){
      let node = nodeByTag[nodeTag];
      if (nodeTag === 'm_mother') {
        person.mother = node;
      } else if (nodeTag === 'm_father'){
        person.father = node;
      } else if (nodeTag.startsWith('m_extended_')){
        const rel = node.qNode.relationship;
        if ('cousin' === rel) {
          node.parents = [person];
        }
      }
    }
  } else if (tag.startsWith('f_sibling_')){
    // this can happen if we get a cousin
    for (const nodeTag in nodeByTag){
      let node = nodeByTag[nodeTag];
      if (nodeTag === 'f_mother') {
        person.mother = node;
      } else if (nodeTag === 'f_father'){
        person.father = node;
      } else if (nodeTag.startsWith('f_extended_')){
        const rel = node.qNode.relationship;
        if ('cousin' === rel) {
          node.parents = [person];
        }
      }
    }
  } else if (tag.startsWith('m_extended_')){
    const personRel = person.qNode.relationship;
    switch(personRel){
    case 'grandchild':
      // this will happen if we have a great-grandchild but not a grandchild
      if ('child_1' in nodeByTag){
        if (nodeByTag.child_1.properties.gender === 'M'){
          person.father = nodeByTag.child_1;
        }else if (nodeByTag.child_1.properties.gender === 'F'){
          person.mother = nodeByTag.child_1;
        } else{
          person.parents = [nodeByTag.child_1];
        }
      }
      setParentOfExtended(nodeByTag, person, 'm_extended_', ['great-grandson', 'great-granddaughter', 'great-grandchild']);
      break;
    case 'niece':
      // this will happen if we have a grandniece or grandnephew but not a niece or nephew
      if ('sibling_1' in nodeByTag) {
        if (nodeByTag.sibling_1.properties.gender === 'M') {
          person.father = nodeByTag.sibling_1;
        } else if (nodeByTag.sibling_1.properties.gender === 'F') {
          person.mother = nodeByTag.sibling_1;
        } else {
          person.parents = [nodeByTag.sibling_1];
        }
      }

      setParentOfExtended(nodeByTag, person, 'm_extended_', ['grandniece', 'grandnephew']);
      break;
    case 'great-grandmother':
      // this will happen if we have a granduncle or grandaunt
      setParentOfExtended(nodeByTag, person, 'm_extended_', ['granduncle', 'grandaunt']);
      break;
    }
  } else if (tag.startsWith('f_extended_')) {
    const personRel = person.qNode.relationship;
    switch(personRel){
    case 'grandchild':
      // this will happen if we have a great-grandchild but not a grandchild
      if ('child_1' in nodeByTag){
        if (nodeByTag.child_1.properties.gender === 'M'){
          person.father = nodeByTag.child_1;
        }else if (nodeByTag.child_1.properties.gender === 'F'){
          person.mother = nodeByTag.child_1;
        } else{
          person.parents = [nodeByTag.child_1];
        }
      }
      setParentOfExtended(nodeByTag, person, 'f_extended_', ['great-grandson', 'great-granddaughter', 'great-grandchild']);
      break;
    case 'niece':
      // this will happen if we have a grandniece or grandnephew but not a niece or nephew
      if ('sibling_1' in nodeByTag) {
        if (nodeByTag.sibling_1.properties.gender === 'M') {
          person.father = nodeByTag.sibling_1;
        } else if (nodeByTag.sibling_1.properties.gender === 'F') {
          person.mother = nodeByTag.sibling_1;
        } else {
          person.parents = [nodeByTag.sibling_1];
        }
      }

      setParentOfExtended(nodeByTag, person, 'f_extended_', ['grandniece', 'grandnephew']);
      break;
    case 'great-grandmother':
      // this will happen if we have a granduncle or grandaunt
      setParentOfExtended(nodeByTag, person, 'f_extended_', ['granduncle', 'grandaunt']);
      break;
    }
  } else {

  }

};
//===============================================================================================

export default QuestionnaireConverter;
