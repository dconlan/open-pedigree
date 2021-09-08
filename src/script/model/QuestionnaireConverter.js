import BaseGraph from 'pedigree/model/baseGraph';
import RelationshipTracker from 'pedigree/model/relationshipTracker';
import NameSplitter from '../util/NameSplitter';



function splitDate(dateString){
  let ymdRegex =/^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)([-/](0[1-9]|1[0-2])([-/](0[1-9]|[1-2][0-9]|3[0-1]))?)?$/;
  let dmyRegex =/^(((0?[1-9]|[1-2][0-9]|3[0-1])[-/])?(0?[1-9]|1[0-2])[-/])?([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)$/;
  let yearsRegex =/^([0-9]{1,3})\s*(y|yrs|years)$/i;
  let monthsRegex =/^([0-9]{1,2})\s*(m|mths|months)$/i;
  let weeksRegex =/^([0-9]{1,2})\s*(w|wks|weeks)$/i;

  let dateSplit = ymdRegex.exec(dateString);
  if (dateSplit != null){
    let result = { year: parseInt(dateSplit[1]) };
    if (dateSplit[5] && dateSplit[5].length === 2){
      result.month = parseInt(dateSplit[5]);
    }
    if (dateSplit[7] && dateSplit[7].length === 2){
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

  let conditions = [];

  // get conditions from proband if there are any
  for (const qNode of questionnaireData) {

    if ('condition_code' in qNode){
      for (let i=0; i< qNode.condition_code.length;i++){
        let code = qNode.condition_code[i];
        let display = ('condition_display' in qNode && qNode.condition_display.length > i)? qNode.condition_display[i] : '';
        let other = ('condition_other' in qNode && qNode.condition_other.length > i)? qNode.condition_other[i] : '';

        if ('_NRF_' === code){
          conditions.push({code: other, display: other});
        }
        else {
          conditions.push({code: code, display: display});
        }
      }
      break;
    }
  }

  for (const qNode of questionnaireData) {
    let person = QuestionnaireConverter.extractDataFromQuestionnaireNode(qNode, conditions);
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
    } else if (person.qNode.tag.startsWith('child_')){
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
        properties: {id: childTag, externalId: childTag, gender: 'U'},
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
      let connectionNode = cluster.size === 1 ? person: QuestionnaireConverter.findBestConnectInCluster(cluster);
      QuestionnaireConverter.addMissingNodes(connectionNode, nodeByTag, fakeNodes, badNodes);
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

  // reuse the same fake partner we possible
  let fakePartners = {};

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
      if (motherLink in fakePartners){
        fatherID = fakePartners[motherLink];
      } else {
        fatherID = newG._addVertex(null, BaseGraph.TYPE.PERSON, {
          'gender' : 'M',
          'comments' : 'unknown'
        }, newG.defaultPersonNodeWidth);
        fakePartners[motherLink] = fatherID;
      }
    } else {
      fatherID = fatherLink;
      if (newG.properties[fatherID].gender === 'F') {
        throw 'Unable to import pedigree: a person declared as female is also declared as being a father ('
        + fatherLink + ')';
      }
    }
    if (motherLink == null) {
      if (fatherLink in fakePartners){
        motherID = fakePartners[fatherLink];
      } else {
        motherID = newG._addVertex(null, BaseGraph.TYPE.PERSON, {
          'gender' : 'F',
          'comments' : 'unknown'
        }, newG.defaultPersonNodeWidth);
        fakePartners[fatherLink] = motherID;
      }
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
    console.log('Add edge for edge, child, mother, father', chhubID, personID, motherID, fatherID);
    newG.addEdge(chhubID, personID, defaultEdgeWeight);
  }

  newG.validate();
  // PedigreeImport.validateBaseGraph(newG);
  return newG;
};

QuestionnaireConverter.extractDataFromQuestionnaireNode = function (qNode, conditions) {
  let properties = {id: qNode.tag, externalId: qNode.tag};
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

  const splitName = NameSplitter.split(qNode.name ? qNode.name : '');
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

  if ('condition_code' in qNode){
    if ('proband' === qNode.tag){
      // this is the proband, so real conditions
      properties.disorders = [];
      for (let condition of conditions ){
        properties.disorders.push(condition.code);
      }
    }
    else {
      properties.disorders = [];
      let problemComments = [];
      for (let i=0; i< qNode.condition_code.length;i++){
        let code = qNode.condition_code[i];
        let display = ('condition_display' in qNode && qNode.condition_display.length > i)? qNode.condition_display[i] : code;
        let other = ('condition_other' in qNode && qNode.condition_other.length > i)? qNode.condition_other[i] : '';
        let problemText = '';
        if ('_NRF_' === code){
          properties.disorders.push(other);
          problemText = other;
        }
        else {
          properties.disorders.push(code);
          problemText = display;
        }
        if ('condition_age' in qNode && qNode.condition_age.length > i && qNode.condition_age[i].trim().length > 0 && problemText.trim().length > 0){
          problemComments.push(problemText + ' dx ' + qNode.condition_age[i]);
        }
      }
      if (problemComments.length  > 0){
        comments.problem = problemComments.join('\n');
      }
    }
  }

  if ('problem' in qNode){
    properties.disorders = [];
    let problemComments = [];
    for (let i=0; i<qNode.problem.length; i++){
      let p = qNode.problem[i];
      let problemText = '';
      let disorder = false;
      if (p.startsWith('condition_')){
        let indexChar = p[p.length - 1];
        if (indexChar >= '1' && indexChar <= '9'){
          let index = parseInt(indexChar) - 1;
          if (index < conditions.length){
            properties.disorders.push(conditions[index].code);
            problemText = conditions[index].display;
            disorder = true;
          } else {
            console.log(`qNode has condition which is out of range '${p}', condition count = ${conditions.length}`);
            continue;
          }
        }else {
          console.log(`qNode has bad problem value '${p}'`);
          continue;
        }
      } else if ('other' === p && 'problem_other' in qNode && qNode.problem_other.length > i){
        // not a condition, we will just add it as a comment.
        problemText = qNode.problem_other[i];
      }
      if ('problem_age' in qNode && qNode.problem_age.length > i && qNode.problem_age[i].trim().length > 0 && problemText.trim().length > 0){
        problemComments.push(problemText + ' dx ' + qNode.problem_age[i]);
      } else if (problemText.trim().length > 0 && !disorder){
        problemComments.push(problemText);
      }
    }
    comments.problem = problemComments.join('\n');
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
    QuestionnaireConverter.populateDistanceFromProband(node.father, nextStep);
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
  if (extended.length === 1){
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
  while (nextId in nodes || nextId in fakeNodes){
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
      fakeNodes.mother = { qNode: { tag: 'mother'}, properties: {id: 'mother', externalId: 'mother', gender: 'F'}, children: new Set(), partners: new Set()};
    }
  } else if ('m_father' === tag){
    // means we are missing mother
    if (!('mother' in fakeNodes)){
      console.log('adding fake mother due to m_father not connected');
      fakeNodes.mother = { qNode: { tag: 'mother'}, properties: {id: 'mother', externalId: 'mother', gender: 'F'}, children: new Set(), partners: new Set()};
    }
  } else if ('f_mother' === tag){
    // means we are missing father
    if (!('father' in fakeNodes)){
      console.log('adding fake father due to f_mother not connected');
      fakeNodes.father = { qNode: { tag: 'father'}, properties: {id: 'father', externalId: 'father', gender: 'M'}, children: new Set(), partners: new Set()};
    }
  } else if ('f_father' === tag){
    // means we are missing father
    if (!('father' in fakeNodes)){
      console.log('adding fake father due to f_father not connected');
      fakeNodes.father = { qNode: { tag: 'father'}, properties: {id: 'father', externalId: 'father', gender: 'M'}, children: new Set(), partners: new Set()};
    }
  } else if (tag.startsWith('child_')){
    // should not be possible
  } else if (tag.startsWith('partner_')){
    // should not be possible
  } else if (tag.startsWith('sibling_')){
    // means we are missing mother and father
    if (!('mother' in fakeNodes)){
      console.log('adding fake mother due to sibling not connected');
      fakeNodes.mother = { qNode: { tag: 'mother'}, properties: {id: 'mother', externalId: 'mother', gender: 'F'}, children: new Set(), partners: new Set()};
    }
    if (!('father' in fakeNodes)){
      console.log('adding fake father due to sibling not connected');
      fakeNodes.father = { qNode: { tag: 'father'}, properties: {id: 'father', externalId: 'father', gender: 'M'}, children: new Set(), partners: new Set()};
    }
  } else if (tag.startsWith('m_sibling_')){
    // means we are missing m_mother and m_father
    if (!('m_mother' in fakeNodes)){
      console.log('adding fake m_mother due to m_sibling not connected');
      fakeNodes.m_mother = { qNode: { tag: 'm_mother'}, properties: {id: 'm_mother', externalId: 'm_mother', gender: 'F'}, children: new Set(), partners: new Set()};
    }
    if (!('m_father' in fakeNodes)){
      console.log('adding fake m_father due to m_sibling not connected');
      fakeNodes.m_father = { qNode: { tag: 'm_father'}, properties: {id: 'm_father', externalId: 'm_father', gender: 'M'}, children: new Set(), partners: new Set()};
    }
  } else if (tag.startsWith('f_sibling_')){
    // means we are missing f_mother and f_father
    if (!('f_mother' in fakeNodes)){
      console.log('adding fake f_mother due to f_sibling not connected');
      fakeNodes.f_mother = { qNode: { tag: 'f_mother'}, properties: {id: 'f_mother', externalId: 'f_mother', gender: 'F'}, children: new Set(), partners: new Set()};
    }
    if (!('f_father' in fakeNodes)){
      console.log('adding fake f_father due to f_sibling not connected');
      fakeNodes.f_father = { qNode: { tag: 'f_father'}, properties: {id: 'm_father', externalId: 'm_father', gender: 'M'}, children: new Set(), partners: new Set()};
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
        fakeNodes.child_1 = { qNode: { tag: 'child_1'}, properties: {id: 'child_1', externalId: 'child_1', gender: 'U'}, children: new Set(), partners: new Set()};
        break;
      case 'great-grandson':
      case 'great-granddaughter':
      case 'great-grandchild':
        // means we are missing grandchild
        console.log('adding fake m_extended grandchild due to m_extended great-grandchild not connected');
        fakeTag = getNextId('m_extended_', nodeByTag, fakeNodes);
        fakeNodes[fakeTag] = { qNode: { tag: fakeTag, relationship: 'grandchild'}, properties: {id: fakeTag, externalId: fakeTag, gender: 'U'}, children: new Set(), partners: new Set()};
        // deal with missing child
        QuestionnaireConverter.addMissingNodes(fakeNodes[fakeTag], nodeByTag, fakeNodes);
        break;
      case 'niece':
      case 'nephew':
        // means we are missing sibling
        console.log('adding fake sibling_1 due to m_extended niece/nephew not connected');
        fakeNodes.sibling_1 = { qNode: { tag: 'sibling_1'}, properties: {id: 'sibling_1', externalId: 'sibling_1', gender: 'U'}, children: new Set(), partners: new Set()};
        if (!('mother' in nodeByTag || 'father' in nodeByTag || 'mother' in fakeNodes || 'father' in fakeNodes )) {
          QuestionnaireConverter.addMissingNodes(fakeNodes.sibling_1, nodeByTag, fakeNodes);
        }
        break;
      case 'grandniece':
      case 'grandnephew':
        // means we are missing niece or nephew
        console.log('adding fake m_extended niece due to m_extended grandniece/grandnephew not connected');
        fakeTag = getNextId('m_extended_', nodeByTag, fakeNodes);
        fakeNodes[fakeTag] = { qNode: { tag: fakeTag, relationship: 'niece'}, properties: {id: fakeTag, externalId: fakeTag, gender: 'U'}, children: new Set(), partners: new Set()};
        // deal with missing sibling
        QuestionnaireConverter.addMissingNodes(fakeNodes[fakeTag], nodeByTag, fakeNodes);
        break;
      case 'cousin':
        // means we are missing m_sibling
        console.log('adding fake m_sibling_1 due to m_extended cousin not connected');
        fakeNodes.m_sibling_1 = { qNode: { tag: 'm_sibling_1'}, properties: {id: 'm_sibling_1', externalId: 'm_sibling_1', gender: 'U'}, children: new Set(), partners: new Set()};
        if (!(hasExtended(nodeByTag, fakeNodes, 'm_extended_', ['great-grandmother', 'great-grandfather']))) {
          QuestionnaireConverter.addMissingNodes(fakeNodes.sibling_1, nodeByTag, fakeNodes);
        }
        break;
      case 'great-grandmother':
      case 'great-grandfather':
        // means we are missing grandparent
        if (!('m_mother' in fakeNodes)){
          console.log('adding fake m_mother due to m_extended great-grandparent not connected');
          fakeNodes.m_mother = { qNode: { tag: 'm_mother'}, properties: {id: 'm_mother', externalId: 'm_mother', gender: 'F'}, children: new Set(), partners: new Set()};
          if (!('mother' in nodeByTag || 'mother' in fakeNodes )) {
            QuestionnaireConverter.addMissingNodes(fakeNodes.m_mother, nodeByTag, fakeNodes);
          }
        }
        if (!('m_father' in fakeNodes)){
          console.log('adding fake m_father due to m_extended great-grandparent not connected');
          fakeNodes.m_father = { qNode: { tag: 'm_father'}, properties: {id: 'm_father', externalId: 'm_father', gender: 'M'}};
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
        fakeNodes.fakeTag = { qNode: { tag: fakeTag, relationship: 'great-grandmother'}, properties: {id: fakeTag, externalId: fakeTag, gender: 'U'}, children: new Set(), partners: new Set()};
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
        fakeNodes.child_1 = {qNode: {tag: 'child_1'}, properties: {id: 'child_1', externalId: 'child_1', gender: 'U'}, children: new Set(), partners: new Set()};
        break;
      case 'great-grandson':
      case 'great-granddaughter':
      case 'great-grandchild':
        // means we are missing grandchild
        console.log('adding fake f_extended grandchild due to f_extended great-grandchild not connected');
        fakeTag = getNextId('f_extended_', nodeByTag, fakeNodes);
        fakeNodes[fakeTag] = {qNode: {tag: fakeTag, relationship: 'grandchild'}, properties: {id: fakeTag, externalId: fakeTag, gender: 'U'}, children: new Set(), partners: new Set()};
        // deal with missing child
        QuestionnaireConverter.addMissingNodes(fakeNodes[fakeTag], nodeByTag, fakeNodes);
        break;
      case 'niece':
      case 'nephew':
        // means we are missing sibling
        console.log('adding fake sibling_1 due to f_extended niece/nephew not connected');
        fakeNodes.sibling_1 = {qNode: {tag: 'sibling_1'}, properties: {id: 'sibling_1', externalId: 'sibling_1', gender: 'U'}, children: new Set(), partners: new Set()};
        if (!('mother' in nodeByTag || 'father' in nodeByTag || 'mother' in fakeNodes || 'father' in fakeNodes )) {
          QuestionnaireConverter.addMissingNodes(fakeNodes.sibling_1, nodeByTag, fakeNodes);
        }
        break;
      case 'grandniece':
      case 'grandnephew':
        // means we are missing niece or nephew
        console.log('adding fake f_extended niece due to f_extended grandniece/grandnephew not connected');
        fakeTag = getNextId('f_extended_', nodeByTag, fakeNodes);
        fakeNodes[fakeTag] = {qNode: {tag: fakeTag, relationship: 'niece'}, properties: {id: fakeTag, externalId: fakeTag, gender: 'U'}, children: new Set(), partners: new Set()};
        // deal with missing sibling
        QuestionnaireConverter.addMissingNodes(fakeNodes[fakeTag], nodeByTag, fakeNodes);
        break;
      case 'cousin':
        // means we are missing m_sibling
        console.log('adding fake f_sibling_1 niece due to f_extended cousin not connected');
        fakeNodes.f_sibling_1 = {qNode: {tag: 'f_sibling_1'}, properties: {id: 'f_sibling_1', externalId: 'f_sibling_1', gender: 'U'}, children: new Set(), partners: new Set()};
        if (!(hasExtended(nodeByTag, fakeNodes, 'f_extended_', ['great-grandmother', 'great-grandfather']))) {
          QuestionnaireConverter.addMissingNodes(fakeNodes.sibling_1, nodeByTag, fakeNodes);
        }
        break;
      case 'great-grandmother':
      case 'great-grandfather':
        // means we are missing grandparent
        if (!('f_mother' in fakeNodes)) {
          console.log('adding fake f_mother due to f_extended great-grandparent not connected');
          fakeNodes.f_mother = {qNode: {tag: 'f_mother'}, properties: {id: 'f_mother', externalId: 'f_mother', gender: 'F'}, children: new Set(), partners: new Set()};
          if (!('father' in nodeByTag || 'father' in fakeNodes )) {
            QuestionnaireConverter.addMissingNodes(fakeNodes.m_mother, nodeByTag, fakeNodes);
          }
        }
        if (!('f_father' in fakeNodes)) {
          console.log('adding fake f_father due to f_extended great-grandparent not connected');
          fakeNodes.f_father = {qNode: {tag: 'f_father'}, properties: {id: 'f_father', externalId: 'f_mother', gender: 'M'}, children: new Set(), partners: new Set()};
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
        fakeNodes.fakeTag = {qNode: {tag: fakeTag, relationship: 'great-grandmother'}, properties: {id: fakeTag, externalId: fakeTag, gender: 'U'}, children: new Set([person]), partners: new Set()};
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


function setIfMissing(obj, attrib, value){
  if (!(attrib in obj)){
    obj[attrib] = value;
  }
}

const relOrder = [ 'self', 'parent', 'child', 'sibling', 'grandparent', 'great-grandparent', 'nibling', 'pibling', 'grandnibling', 'grandpibling', 'great-great-grandparent', 'great-grandpibling', 'cousin'];
const relHelper = {
  self: 'child',
  child: 'grandchild',
  parent: 'sibling',
  sibling: 'nibling',
  nibling: 'grandnibling',
  grandparent: 'pibling',
  pibling: 'cousin',
  cousin: 'cousin',
  'great-grandparent': 'grandpibling',
  'grandpibling': 'cousin',
  'great-great-grandparent': 'great-grandpibling',
  'great-grandpibling': 'cousin',
};

function addRelationshipToChildren(connections, index, relationship ){
  let node = connections[index];
  if (!node){
    return;
  }
  if ('relationship' in node){
    let currIndex = relOrder.indexOf(node.relationship);
    if (currIndex === -1){
      currIndex = relOrder.length;
    }
    let newIndex = relOrder.indexOf(relationship);
    if (newIndex === -1){
      newIndex = relOrder.length;
    }
    if (currIndex <= newIndex){
      // already here
      return;
    }
  }
  node.relationship = relationship;

  const nextRel = (relationship in relHelper) ? relHelper[relationship] : 'great-' + relationship;

  for (let childrenNode of node.children){
    addRelationshipToChildren(connections, childrenNode, nextRel);
  }
}

function addSideToChildren(connections, index, side ){
  let node = connections[index];
  if (!node){
    return;
  }
  if ('side' in node){
    return;
  }
  node.side = side;

  for (let childrenNode of node.children){
    addSideToChildren(connections, childrenNode, side);
  }
}


QuestionnaireConverter.createQuestionnaireDataFromGraph = function (pedigree, oldQData) {
  // go through the pedigree and add external id's that match the
  console.log(pedigree);
  let oldQDataByTag = {};
  if (oldQData) {
    for (let od of oldQData) {
      oldQDataByTag[od.tag] = od;
    }
  }
  let qData = [];
  let connections = [];
  let nextId = {
    partner_: 1,
    child_: 1,
    sibling_: 1,
    m_sibling_: 1,
    f_sibling_: 1,
    m_extended_: 1,
    f_extended_: 1
  };

  for (let i = 0; i <= pedigree.GG.getMaxRealVertexId(); i++) {
    if (!pedigree.GG.isPerson(i)) {
      continue;
    }
    if (!connections[i]) {
      connections[i] = {parents: new Set(), children: new Set(), partners: new Set()};
    }
    let parents = pedigree.GG.getParents(i);
    for (let parent of parents) {
      connections[i].parents.add(parent);
      if (!connections[parent]) {
        connections[parent] = {parents: new Set(), children: new Set(), partners: new Set()};
      }
      connections[parent].children.add(i);
    }
    if (parents.length === 2) {
      let parentArray = [...parents];
      connections[parentArray[0]].partners.add(parentArray[1]);
      connections[parentArray[1]].partners.add(parentArray[0]);
    }
    let mother = pedigree.GG.getMother(i);
    if (mother !== null) {
      connections[i].mother = mother;
    }
    let father = pedigree.GG.getFather(i);
    if (father !== null) {
      connections[i].father = father;
    }
  }
  // hookup siblings
  let nodesToAddSiblingTo = [0];
  for (let node of connections[0].parents){
    nodesToAddSiblingTo.push(node);
  }

  for (let node of nodesToAddSiblingTo) {
    connections[node].siblings = new Set();
    for (let parentNode of connections[node].parents) {
      for (let childNode of connections[parentNode].children) {
        if (childNode !== node) {
          connections[node].siblings.add(childNode);
        }
      }
    }
  }
  if (connections[0].parents.size > 0) {

    if ('mother' in connections[0] && !('father' in connections[0]) && connections[0].parents.size === 2) {
      for (let p of connections[0].parents) {
        if (p !== connections[0].mother) {
          connections[0].father = p;
          break;
        }
      }
    } else if ('father' in connections[0] && !('mother' in connections[0]) && connections[0].parents.size === 2) {
      for (let p of connections[0].parents) {
        if (p !== connections[0].father) {
          connections[0].mother = p;
          break;
        }
      }
    } else {
      // just make first father and second mother
      for (let p of connections[0].parents) {
        if (!('father' in connections[0])) {
          connections[0].father = p;
        } else if (!('mother' in connections[0])) {
          connections[0].mother = p;
        }
      }
    }
  }

  connections[0].tag = 'proband';

  for (let childNode of connections[0].children) {
    setIfMissing(connections[childNode], 'tag', 'child_');
  }

  for (let partnerNode of connections[0].partners) {
    setIfMissing(connections[partnerNode], 'tag', 'partner_');
  }
  for (let siblingNode of connections[0].siblings) {
    setIfMissing(connections[siblingNode], 'tag', 'sibling_');
  }
  if ('mother' in connections[0]) {
    let mother = connections[0].mother;
    setIfMissing(connections[mother], 'tag', 'mother');
    for (let siblingNode of connections[mother].siblings) {
      setIfMissing(connections[siblingNode], 'tag', 'm_sibling_');
    }
    if ('mother' in connections[mother]) {
      setIfMissing(connections[connections[mother].mother], 'tag', 'm_mother');
    }
    if ('father' in connections[mother]) {
      setIfMissing(connections[connections[mother].father], 'tag', 'm_father');
    }
  }
  if ('father' in connections[0]) {
    let father = connections[0].father;
    setIfMissing(connections[father], 'tag', 'father');
    for (let siblingNode of connections[father].siblings) {
      setIfMissing(connections[siblingNode], 'tag', 'f_sibling_');
    }
    if ('mother' in connections[father]) {
      setIfMissing(connections[connections[father].mother], 'tag', 'f_mother');
    }
    if ('father' in connections[father]) {
      setIfMissing(connections[connections[father].father], 'tag', 'f_father');
    }
  }

  let parentsToProcess = new Set([0]);
  let rel = 'self';
  while(parentsToProcess.size > 0){
    let nextParents = new Set();
    for (let n of parentsToProcess){
      addRelationshipToChildren(connections, n, rel);
      for (let np of connections[n].parents){
        nextParents.add(np);
      }
    }
    if (rel === 'self'){
      rel = 'parent';
    } else if (rel === 'parent'){
      rel = 'grandparent';
    } else {
      rel = 'great-' + rel;
    }
    parentsToProcess = nextParents;
  }
  addSideToChildren(connections, 0, 'd');
  if ('mother' in connections[0]){
    parentsToProcess = new Set([connections[0].mother]);
    while(parentsToProcess.size > 0){
      let nextParents = new Set();
      for (let n of parentsToProcess){
        addSideToChildren(connections, n, 'm');
        for (let np of connections[n].parents){
          nextParents.add(np);
        }
      }
      parentsToProcess = nextParents;
    }
  }
  if ('father' in connections[0]){
    parentsToProcess = new Set([connections[0].father]);
    while(parentsToProcess.size > 0){
      let nextParents = new Set();
      for (let n of parentsToProcess){
        addSideToChildren(connections, n, 'f');
        for (let np of connections[n].parents){
          nextParents.add(np);
        }
      }
      parentsToProcess = nextParents;
    }
  }

  let disorderLegend = editor.getDisorderLegend();
  let probandDisorders = [];
  if (pedigree.GG.properties[0].disorders) {
    for (let prob of pedigree.GG.properties[0].disorders){
      let disorderTerm = disorderLegend.getTerm(prob);
      if (disorderTerm.getName() === disorderTerm.getID()){
        probandDisorders.push({
          code: '_NRF_',
          display: 'No Result Found',
          other: prob,
          entry: prob
        });
      } else {
        probandDisorders.push({
          code: prob,
          display: disorderTerm.getName(),
          other: '',
          entry: disorderTerm.getName()
        });
      }
    }
  }
  for (let i = 0; i <= pedigree.GG.getMaxRealVertexId(); i++) {
    if (!pedigree.GG.isPerson(i)) {
      continue;
    }
    let nodeData = QuestionnaireConverter.createQuestionnaireDataNode(i, pedigree, connections, nextId, probandDisorders);
    if (nodeData) {
      qData.push(nodeData);
    }
  }
  console.log('connections', connections);
  return qData;
};


let tagOrder = ['proband', 'mother', 'father', 'child_', 'sibling_', 'm_mother', 'm_father', 'f_mother', 'f_father',
  'm_sibling_', 'f_sibling_', 'm_extended_', 'f_extended_'];

function findConnectedRelative(relations, connections, pedigree){

  let bestIndex = undefined;
  let bestIndexVal = tagOrder.length;

  for (let relIndex of relations){
    let curVal = tagOrder.indexOf(connections[relIndex].tag);
    if (curVal < 0){
      curVal = tagOrder.length;
    }
    if (bestIndexVal > curVal){
      bestIndexVal = curVal;
      bestIndex = relIndex;
    }
  }
  if (bestIndex === tagOrder.length){
    return null; // we didn't find anything
  }
  let names = [];
  let properties = pedigree.GG.properties[bestIndex];
  if (properties.fName){
    names.push(properties.fName);
  }
  if (properties.lName){
    names.push(properties.lName);
  }
  return names.join(' ');
}

QuestionnaireConverter.createQuestionnaireDataNode = function(nodeIndex, pedigree, connections, nextId, probandDisorders){
  let node = {};
  const properties = pedigree.GG.properties[nodeIndex];

  const probandAttributes = ['name', 'sex', 'dob', 'condition_'];

  const partnerAttributes = ['name', 'dob', 'deceased', 'dod', 'cause_death'];

  const childAttributes = ['name', 'sex', 'dob', 'parent_tag', 'problem_', 'deceased', 'dod', 'cause_death', 'condition_'];

  const motherAttributes = ['name', 'dob', 'maiden_name', 'problem_', 'deceased', 'dod', 'cause_death', 'condition_'];

  const fatherAttributes = ['name', 'dob', 'problem_', 'deceased', 'dod', 'cause_death', 'condition_'];

  const extendedAttributes = ['name', 'relationship', 'parent', 'problem_', 'deceased', 'dod', 'cause_death', 'condition_'];

  const siblingAttributes = ['name', 'sex', 'dob', 'sibling_type', 'problem_', 'deceased', 'dod', 'cause_death', 'condition_'];

  let attributes = undefined;

  if ('tag' in connections[nodeIndex]){
    switch(connections[nodeIndex].tag){
    case 'proband':
      attributes = probandAttributes;
      break;
    case 'mother':
    case 'm_mother':
    case 'f_mother':
      attributes = motherAttributes;
      break;
    case 'father':
    case 'm_father':
    case 'f_father':
      attributes = fatherAttributes;
      break;
    case 'partner_':
      attributes = partnerAttributes;
      break;
    case 'child_':
      attributes = childAttributes;
      break;
    case 'sibling_':
    case 'm_sibling_':
    case 'f_sibling_':
      attributes = siblingAttributes;
      break;
    }
  } else if ('relationship' in connections[nodeIndex]){
    attributes = extendedAttributes;
    if ('side' in connections[nodeIndex]){
      if (connections[nodeIndex].side === 'f'){
        connections[nodeIndex].tag = 'f_extended_';
      } else {
        connections[nodeIndex].tag = 'm_extended_';
      }
    } else {
      // use mothers side for grandchildred
      connections[nodeIndex].tag = 'm_extended_';
    }
  } else {
    return null; // not genetically linked
  }
  if (connections[nodeIndex].tag.endsWith('_')){
    const id = nextId[connections[nodeIndex].tag];
    nextId[connections[nodeIndex].tag]++;
    node.tag = connections[nodeIndex].tag + id;
  }
  else {
    node.tag = connections[nodeIndex].tag;
  }

  let commentLines = (properties.comments) ? properties.comments.split('\n') : [];

  let birthCommentRegex = /^(b\. ((([1-9]|1[0-2])-)?([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000))|([0-9]{1,3}[ymw]))$/;
  let deathCommentRegex = /^d\. ((([1-9]|1[0-2])-)?([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)|[0-9]{1,3}[ymw])? ?(.*)?$/;
  let probAgeRegex = /^(.+) dx (.+)$/;
  let foundBirthComment = false;
  let foundDeathComment = false;
  let commentDob = undefined;
  let commentDod = undefined;
  let commentCod = undefined;
  let commentProblem = [];
  for (let comment of commentLines){
    if (!foundBirthComment){
      let birthSplit = birthCommentRegex.exec(comment);
      if (birthSplit !== null){
        commentDob = birthSplit[2] || birthSplit[8];
        foundBirthComment = true;
        continue;
      }
    }
    if (!foundDeathComment){
      let deathSplit = deathCommentRegex.exec(comment);
      if (deathSplit !== null){
        commentDod = deathSplit[1];
        commentCod = deathSplit[7];
        foundDeathComment = true;
        continue;
      }
    }
    let probAgeSplit = probAgeRegex.exec(comment);
    if (probAgeSplit !== null){
      commentProblem.push({problem: probAgeSplit[1], age: probAgeSplit[2]});
    }
  }

  for (const attrib of attributes){
    switch(attrib){
    case 'cause_death':
      if (commentCod){
        node.cause_death = commentCod;
      }
      break;
    case 'condition_':
      if (node.tag === 'proband'){
        // proband problem fields
        for (let pi=0; pi < probandDisorders.length; pi++){
          let disorder = probandDisorders[pi];
          let ci = pi+1;
          node['condition_code_' + ci] = disorder.code;
          node['condition_display_' + ci] = disorder.display;
          node['condition_other_' + ci] = disorder.other;
          node['condition_entry_' + ci] = disorder.entry;
        }
      }else {
        let disorderLegend = editor.getDisorderLegend();
        if (properties.disorders) {
          let ci = 1;
          for (let prob of properties.disorders){
            let disorderTerm = disorderLegend.getTerm(prob);
            let probText = prob;
            if (disorderTerm.getName() === disorderTerm.getID()){
              node['condition_code_' + ci] = '_NRF_';
              node['condition_display_' + ci] = 'No Result Found';
              node['condition_other_' + ci] = prob;
              node['condition_entry_' + ci] = prob;
            } else {
              node['condition_code_' + ci] = prob;
              node['condition_display_' + ci] = disorderTerm.getName();
              node['condition_other_' + ci] = '';
              node['condition_entry_' + ci] = disorderTerm.getName();
              probText = disorderTerm.getName();
            }
            let condition_age = '';
            for (let cpa of commentProblem){
              if (cpa.problem == probText){
                condition_age = cpa.age;
                break;
              }
            }
            node['condition_age_' + ci] = condition_age;
            ci++;
          }
        }
      }
      break;
    case 'deceased':
      node.deceased = (properties.lifeStatus === 'deceased' || properties.lifeStatus === 'stillborn'
        || properties.lifeStatus === 'miscarriage' || properties.lifeStatus === 'aborted' || properties.lifeStatus === 'unborn');
      break;
    case 'dob':
      if (properties.dob) {
        let d = new Date(properties.dob);
        node.dob = d.getDate() + '-' + (d.getMonth() + 1) + '-' + d.getFullYear();
      } else if (commentDob){
        node.dob = commentDob;
      }
      break;
    case 'dod':
      if (properties.dod) {
        let d = new Date(properties.dod);
        node.dod = d.getDate() + '-' + (d.getMonth() + 1) + '-' + d.getFullYear();
      } else if (commentDob){
        node.dod = commentDod;
      }
      break;
    case 'maiden_name':
      if (properties.lNameAtB){
        node.maiden_name = properties.lNameAtB;
      }
      break;
    case 'name':
      {
        let names = [];
        if (properties.fName){
          names.push(properties.fName);
        }
        if (properties.lName){
          names.push(properties.lName);
        }
        node.name = names.join(' ');
      }
      break;
    case 'parent':
      if ('relationship' in connections[nodeIndex]) {
        let rel = connections[nodeIndex].relationship;
        let parentName = undefined;
        if (rel === 'grandchild' || rel === 'great-grandchild' || rel === 'nibling'
           || rel === 'grandnibling' || rel === 'grandpibling' || rel === 'cousin') {
          parentName = findConnectedRelative(connections[nodeIndex].parents, connections, pedigree);
        } else if (rel === 'great-grandparent') {
          parentName = findConnectedRelative(connections[nodeIndex].children, connections, pedigree);
        }
        if (parentName){
          node.parent = parentName;
        }
      }
      break;
    case 'parent_tag':
      {
        let parentIds = [...connections[nodeIndex].parents];
        if (parentIds[0] === 0 && parentIds[1]){
          node.parent_tage = connections[parentIds[1]].tag;
        } else if (parentIds[1] === 0 && parentIds[0]){
          node.parent_tage = connections[parentIds[1]].tag;
        }
      }
      break;
    case 'problem_':
      // the problem_%, problem_other_% and problem_age_% fields
      {
        let problemSet = new Set(properties.disorders);
        let pi = 1;
        for (let cpa of commentProblem){
          let problem = 'other';
          let found = false;
          for (let di=0; di < probandDisorders.length; di++){
            let disorder = probandDisorders[di];
            // the comment will have the display, not the code
            if (cpa.problem === disorder.display){
              problem = 'condition_' + (di + 1);
              problemSet.delete(disorder.code);
              found = true;
              break;
            } else if (cpa.problem === disorder.other){
              problem = 'condition_' + (di + 1);
              problemSet.delete(disorder.other);
              found = true;
              break;
            }
          }
          node['problem_' + pi] = problem;
          node['problem_other_' + pi] = (found) ? '' : cpa.problem;
          node['problem_age_' + pi] = cpa.age;
          pi++;
        }
        for (let prob of problemSet){
          let problem = 'other';
          let found = false;
          for (let di=0; di < probandDisorders.length; di++){
            let disorder = probandDisorders[di];
            if (prob === disorder.other || prob === disorder.code){
              problem = 'condition_' + (di + 1);
              found = true;
              break;
            }
          }
          node['problem_' + pi] = problem;
          node['problem_other_' + pi] = (found) ? '' : prob;
          node['problem_age_' + pi] = '';
          pi++;
        }
      }
      break;
    case 'relationship':
      if ('relationship' in connections[nodeIndex]){
        let rel = connections[nodeIndex].relationship;
        if (rel === 'grandchild'){
          if (properties.gender === 'M'){
            rel = 'grandson';
          } else if (properties.gender === 'F'){
            rel = 'granddaughter';
          }
        } else if (rel === 'great-grandchild'){
          if (properties.gender === 'M'){
            rel = 'great-grandson';
          } else if (properties.gender === 'F'){
            rel = 'great-granddaughter';
          }
        } else if (rel === 'nibling'){
          if (properties.gender === 'M'){
            rel = 'nephew';
          } else if (properties.gender === 'F'){
            rel = 'niece';
          } else {
            rel = ''; // no relationship for no gender nibling
          }
        } else if (rel === 'grandnibling'){
          if (properties.gender === 'M'){
            rel = 'grandnephew';
          } else if (properties.gender === 'F'){
            rel = 'grandniece';
          } else {
            rel = ''; // no relationship for no gender grandnibling
          }
        } else if (rel === 'great-grandparent'){
          if (properties.gender === 'M'){
            rel = 'great-grandfather';
          } else if (properties.gender === 'F'){
            rel = 'great-grandmother';
          } else {
            rel = ''; // great-grandparent not on the form.
          }
        } else if (rel === 'grandpibling'){
          if (properties.gender === 'M'){
            rel = 'granduncle';
          } else if (properties.gender === 'F'){
            rel = 'grandaunt';
          } else {
            rel = ''; // great-grandparent not on the form.
          }
        } else if (rel !== 'cousin'){
          rel = '';
        }
        node.relationship = rel;
      }
      break;
    case 'sex':
      node.sex = properties.gender;
      break;
    case 'sibling_type':
      {
        let siblingToFindTag = undefined;
        if (node.tag.startsWith('sibling')){
          siblingToFindTag = 'proband';
        } else if (node.tag.startsWith('m_')){
          siblingToFindTag = 'mother';
        } else if (node.tag.startsWith('f_')){
          siblingToFindTag = 'father';
        }
        let siblingToFindId = 0;
        for (siblingToFindId=0; siblingToFindId < connections.length; siblingToFindId++){
          if (connections[siblingToFindId] && connections[siblingToFindId].tag === siblingToFindTag){
            // found
            let typeSum = 0;
            for (let par of connections[nodeIndex].parents){
              if (par === connections[siblingToFindId].father){
                typeSum |= 1;
              } else if (par === connections[siblingToFindId].mother){
                typeSum |= 2;
              }
            }
            if (typeSum === 3){
              node.sibling_type = 'full';
            } else if (typeSum === 2){
              node.sibling_type = 'mat';
            } else if (typeSum === 1) {
              node.sibling_type = 'fat';
            }
            break;
          }
        }
      }
      break;
    }
  }
  return node;

};
//===============================================================================================

export default QuestionnaireConverter;
