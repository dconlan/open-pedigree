import BaseGraph from 'pedigree/model/baseGraph';
import RelationshipTracker from "pedigree/model/relationshipTracker";
import TerminologyManager from "pedigree/terminology/terminologyManger";
import {GeneTermType} from "pedigree/terminology/geneTerm";
import {DisorderTermType} from "pedigree/terminology/disorderTerm";
import {PhenotypeTermType} from "pedigree/terminology/phenotypeTerm";


var FHIRConverter = function() {
};

FHIRConverter.prototype = {};

/* ===============================================================================================
 *
 * Creates and returns a BaseGraph from a text string in the "FHIR JSON" format.
 *
 * We will support 2 different styles of fhir resource, a composition in the format used to export the
 * pedigree and a List of FamilyMemberHistory resources.
 * ===============================================================================================
 */

FHIRConverter.initFromFHIR = function(inputText) {
	let inputResource = null;
	try {
		inputResource = JSON.parse(inputText);
	} catch (err) {
		throw "Unable to import pedigree: input is not a valid JSON string "
				+ err;
	}
	// if (inputResource.resourceType === "Composition") {
	// 	// first see if we have extension with raw data
	// 	if (inputResource.extension) {
	// 		let exArr = inputResource.extension;
	// 		for (let i = 0; i < exArr.length; i++) {
	// 			if (exArr[i].url === "https://github.com/aehrc/panogram/panogram-data-extension") {
	// 				let jsonDataString = exArr[i].valueAttachment.data;
	// 				let jsonData = decodeURIComponent(escape(window
	// 						.atob(jsonDataString)));
	//
	// 				return PedigreeImport.initFromSimpleJSON(jsonData);
	// 			}
	// 		}
	// 	}
	// }
	if (inputResource.resourceType === "Composition"
			|| inputResource.resourceType === "List") {

		let containedResourcesLookup = {};
		let familyHistoryResources = [];
		if (inputResource.contained) {
			let containedArr = inputResource.contained;
			for (let i = 0; i < containedArr.length; i++) {
				containedResourcesLookup["#" + containedArr[i].id] = containedArr[i];
				if (containedArr[i].resourceType === "FamilyMemberHistory") {
					familyHistoryResources.push(containedArr[i]);
				}
			}
		}
		let subjectRef = inputResource.subject;
		let subjectResource = null;
		if (subjectRef && subjectRef.reference
				&& subjectRef.reference[0] === "#") {
			// we have a contained patient
			subjectResource = containedResourcesLookup[subjectRef.reference];
		}
		let newG = new BaseGraph();

		let nameToID = {};
		let externalIDToID = {};
		let ambiguousReferences = {};
		let hasID = {};

		let nodeData = [];
		// first pass: add all vertices and assign vertex IDs
		for (let i = 0; i < familyHistoryResources.length; i++) {
			let nextPerson = this.extractDataFromFMH(familyHistoryResources[i],
					subjectResource, containedResourcesLookup);
			nodeData.push(nextPerson);

			if (!nextPerson.properties.hasOwnProperty("id")
					&& !nextPerson.properties.hasOwnProperty("fName")
					&& !nextPerson.properties.hasOwnProperty("externalId")) {
				throw "Unable to import pedigree: a node with no ID or name is found";
			}

			let pedigreeID = newG._addVertex(null, BaseGraph.TYPE.PERSON, nextPerson.properties,
					newG.defaultPersonNodeWidth);

			if (nextPerson.properties.id) {
				if (externalIDToID.hasOwnProperty(nextPerson.properties.id)) {
					throw "Unable to import pedigree: multiple persons with the same ID ["
							+ nextPerson.properties.id + "]";
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
				} else if (externalIDToID
						.hasOwnProperty(nextPerson.properties.fName)
						&& externalIDToID[nextPerson.properties.fName] !== pedigreeID) {
					// some other node has this name as an ID
					delete externalIDToID[nextPerson.properties.fName];
					ambiguousReferences[nextPerson.properties.fName] = true;
				} else {
					nameToID[nextPerson.properties.fName] = pedigreeID;
				}
			}
			// only use externalID if id is not present
			if (nextPerson.properties.hasOwnProperty("externalId")
					&& !hasID.hasOwnProperty(pedigreeID)) {
				externalIDToID[nextPerson.properties.externalId] = pedigreeID;
				hasID[pedigreeID] = true;
			}
		}

		let getPersonID = function(person) {
			if (person.properties.hasOwnProperty("id"))
				return externalIDToID[person.properties.id];

			if (person.hasOwnProperty("fName"))
				return nameToID[person.properties.fName];
		};

		let findReferencedPerson = function(reference, refType) {
			if (ambiguousReferences.hasOwnProperty(reference))
				throw "Unable to import pedigree: ambiguous reference to ["
						+ reference + "]";

			if (externalIDToID.hasOwnProperty(reference))
				return externalIDToID[reference];

			if (nameToID.hasOwnProperty(reference))
				return nameToID[reference];

			throw "Unable to import pedigree: ["
					+ reference
					+ "] is not a valid "
					+ refType
					+ " reference (does not correspond to a name or an ID of another person)";
		};

		let defaultEdgeWeight = 1;

		let relationshipTracker = new RelationshipTracker(newG,
				defaultEdgeWeight);

		// second pass (once all vertex IDs are known): process parents/children & add edges
		for (let i = 0; i < nodeData.length; i++) {
			let nextPerson = nodeData[i];

			let personID = getPersonID(nextPerson);

			let motherLink = nextPerson.hasOwnProperty("mother") ? nextPerson["mother"]
					: null;
			let fatherLink = nextPerson.hasOwnProperty("father") ? nextPerson["father"]
					: null;

			if (motherLink == null && fatherLink == null)
				continue;

			// create a virtual parent in case one of the parents is missing
			let fatherID = null;
			let motherID = null;
			if (fatherLink == null) {
				fatherID = newG._addVertex(null, BaseGraph.TYPE.PERSON, {
					"gender" : "M",
					"comments" : "unknown"
				}, newG.defaultPersonNodeWidth);
			} else {
				fatherID = findReferencedPerson(fatherLink, "father");
				if (newG.properties[fatherID].gender === "F")
					throw "Unable to import pedigree: a person declared as female is also declared as being a father ("
							+ fatherLink + ")";
			}
			if (motherLink == null) {
				motherID = newG._addVertex(null, BaseGraph.TYPE.PERSON, {
					"gender" : "F",
					"comments" : "unknown"
				}, newG.defaultPersonNodeWidth);
			} else {
				motherID = findReferencedPerson(motherLink, "mother");
				if (newG.properties[motherID].gender === "M")
					throw "Unable to import pedigree: a person declared as male is also declared as being a mother ("
							+ motherLink + ")";
			}

			if (fatherID === personID || motherID === personID)
				throw "Unable to import pedigree: a person is declared to be his or hew own parent";

			// both motherID and fatherID are now given and represent valid existing nodes in the pedigree

			// if there is a relationship between motherID and fatherID the corresponding childhub is returned
			// if there is no relationship, a new one is created together with the chldhub
			let chhubID = relationshipTracker.createOrGetChildhub(motherID,
					fatherID);

			newG.addEdge(chhubID, personID, defaultEdgeWeight);
		}

		newG.validate();
		// PedigreeImport.validateBaseGraph(newG);

		return newG;
	} else {

		throw "Unable to import pedigree: input is not a resource type we understand";
	}

};

FHIRConverter.extractDataFromFMH = function(familyHistoryResource,
		subjectResource, containedResourcesLookup) {
	let properties = {};
	let result = {
		"properties" : properties
	};

	properties.id = familyHistoryResource.id;
	properties.gender = "U";

	if (familyHistoryResource.sex) {
		let foundCode = false;
		if (familyHistoryResource.sex.coding) {
			let codings = familyHistoryResource.sex.coding;
			for (let i = 0; i < codings.length; i++) {
				if (codings[i].system === "http://hl7.org/fhir/administrative-gender") {
					foundCode = true;
					if (codings[i].code === "male") {
						properties.gender = "M";
					}
					if (codings[i].code === "female") {
						properties.gender = "F";
					}
					break;
				}
			}
		}
		if (!foundCode && familyHistoryResource.sex.text) {
			if (familyHistoryResource.sex.text.toLowerCase() === "male") {
				properties.gender = "M";
			} else if (familyHistoryResource.sex.text.toLowerCase() === "female") {
				properties.gender = "F";
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
	let dateSplitter = /([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2]|[1-9])(-(0[1-9]|[1-2][0-9]|3[0-1]|[1-9]))?)?/;
	if (familyHistoryResource.bornDate) {
		let bornDateSplit = dateSplitter.exec(familyHistoryResource.bornDate);
		if (bornDateSplit == null) {
			// failed to parse the data
		} else {
			let year = bornDateSplit[1];
			let month = (bornDateSplit[5]) ? bornDateSplit[5] : "01";
			let day = (bornDateSplit[7]) ? bornDateSplit[7] : "01";
			// properties.dob = day + "/" + month + "/" + year;
			properties.dob = month + "/" + day + "/" + year;
		}
	}
	if (familyHistoryResource.deceasedDate) {
		let deceasedDateSplit = dateSplitter.exec(familyHistoryResource.deceasedDate);
		if (deceasedDateSplit == null) {
			// failed to parse the data
		} else {
			let year = deceasedDateSplit[1];
			let month = (deceasedDateSplit[5]) ? deceasedDateSplit[5] : "01";
			let day = (deceasedDateSplit[7]) ? deceasedDateSplit[7] : "01";
			// properties.dod = day + "/" + month + "/" + year;
			properties.dod = month + "/" + day + "/" + year;
		}
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
				for (let cIndex = 0; cIndex < condition.coding.length; cIndex++){
					let coding = condition.coding[cIndex];
					if (coding.system === disorderSystem){
						disorders.push(coding.code);
						foundSystem = true;
						break;
					}
				}
				if (!foundSystem){
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
		let motherCodes = [ "NMTH", "MTH", "STPMTH", "ADOPTM" ];
		let fatherCodes = [ "NFTH", "FTH", "STPFTH", "ADOPTF" ];
		let motherRegex = /mother/gi;
		let fatherRegex = /father/gi;
		let extensions = familyHistoryResource.extension;
		let possibleMother = [];
		let possibleFather = [];
		let possibleParent = [];
		for (let i = 0; i < extensions.length; i++) {
			let ex = extensions[i];
			if (ex.url === "http://hl7.org/fhir/StructureDefinition/family-member-history-genetics-parent") {
				let type = null;
				let ref = null;
				let subExtensions = ex.extension;
				for (let j = 0; j < subExtensions.length; j++) {
					let subEx = subExtensions[j];
					if (subEx.url === "type") {
						let codings = subEx.valueCodeableConcept.coding;
						for (let k = 0; k < codings.length; k++) {
							if (codings[k].system === "http://terminology.hl7.org/CodeSystem/v3-RoleCode") {
								if (motherCodes.includes(codings[k].code)) {
									type = "mother";
								} else if (fatherCodes
										.includes(codings[k].code)) {
									type = "father";
								} else {
									type = "parent";
								}
								break;
							} else if (codings[k].display) {
								if (motherRegex.test(codings[k].display)) {
									type = "mother";
								} else if (fatherRegex.test(codings[k].display)) {
									type = "father";
								}
							}
						}
						if (type == null && subEx.valueCodeableConcept.text) {
							if (motherRegex
									.test(subEx.valueCodeableConcept.text)) {
								type = "mother";
							} else if (fatherRegex
									.test(subEx.valueCodeableConcept.text)) {
								type = "father";
							}
						}
						if (type == null) {
							type = "parent";
						}
					} else if (subEx.url === "reference") {
						ref = subEx.valueReference.reference;
					}
				}
				if (ref == null) {
					// we didn't find the reference
					break;
				}
				if (type == null || type === "parent") {
					// check the reference entity for a gender
					if (containedResourcesLookup[ref]) {
						let parentResource = containedResourcesLookup[ref];
						if (parentResource.sex) {
							let foundCode = false;
							if (parentResource.sex.coding) {
								let codings = parentResource.sex.coding;
								for (let c = 0; c < codings.length; c++) {
									if (codings[c].system === "http://hl7.org/fhir/administrative-gender") {
										foundCode = true;
										if (codings[c].code === "male") {
											type = "father";
										}
										if (codings[c].code === "female") {
											type = "mother";
										}
										break;
									}
								}
							}
							if (!foundCode && parentResource.sex.text) {
								if (familyHistoryResource.sex.text
										.toLowerCase() === "male") {
									type = "father";
								} else if (familyHistoryResource.sex.text
										.toLowerCase() === "female") {
									type = "mother";
								}
							}
						}
					}
				}
				let parentId = ref.substring(1); // remove leading #
				if (type === "mother") {
					possibleMother.push(parentId);
				} else if (type === "father") {
					possibleFather.push(parentId);
				} else {
					possibleParent.push(parentId);
				}
			} else if (ex.url === "http://hl7.org/fhir/StructureDefinition/family-member-history-genetics-observation") {
				let observationRef = ex.valueReference.reference;
				let observationResource = containedResourcesLookup[observationRef];
				if (observationResource) {
					let clinical = "fmh_clinical";
					let genes = "fmh_genes";
					let isSympton = false;
					let isGene = false;
					let value = null;
					// let hpoSystem = 'http://purl.obolibrary.org/obo/hp.owl';
					// let geneSystem = 'http://www.genenames.org';
					let hpoSystem = TerminologyManager.getCodeSystem(PhenotypeTermType);
					let geneSystem = TerminologyManager.getCodeSystem(GeneTermType);
					if (observationResource.id.substring(0, clinical.length) === clinical) {
						isSympton = true;
					} else if (observationResource.id.substring(0, genes.length) === genes) {
						isGene = false;
					}
					if (observationResource.valueString){
						value = observationResource.valueString;
					}
					else if (observationResource.valueCodeableConcept){
						if (observationResource.valueCodeableConcept.coding){
							for (let cIndex = 0; cIndex < observationResource.valueCodeableConcept.coding.length; cIndex++){
								let coding = observationResource.valueCodeableConcept.coding[cIndex];
								if (coding.system === geneSystem){
									isGene = true;
									value = coding.code;
									break;
								}
								if (coding.system === hpoSystem){
									isSympton = true;
									value = coding.code;
									break;
								}
							}
						}
						if (value == null && observationResource.valueCodeableConcept.text){
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
		if (possibleParent.length === 1) {
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
	}

	if (familyHistoryResource.relationship
			&& familyHistoryResource.relationship.coding
			&& familyHistoryResource.relationship.code === "ONESELF") {
		// this is the patient, use the subject resource if we have one
		if (subjectResource) {
			if (subjectResource.gender === "male") {
				properties.gender = "M";
			} else if (subjectResource.gender === "female") {
				properties.gender = "F";
			}
		}
		//@TODO add code to grab patient name from patient resource
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

FHIRConverter.exportAsFHIR = function(pedigree, privacySetting, fhirPatientReference) {
	// let exportObj = [];
	let today = new Date();
	let tz = today.getTimezoneOffset();
	let tzHours = tz / 60;
	let tzMins = Math.abs(tz - (tzHours * 60));
	let date = today.getFullYear() + '-' + ((today.getMonth() < 9) ? '0' : '' ) + (today.getMonth() + 1) + '-'
			+ ((today.getDate() < 10) ? '0' : '') + today.getDate();
	let time = ((today.getHours() < 10) ? '0' : '') + today.getHours() + ":" + ((today.getMinutes() < 10) ? '0' : '') + today.getMinutes() + ":"
			+ ((today.getSeconds() < 10) ? '0' : '') + today.getSeconds();
	let timezone = ((tzHours >= 0) ? '+' : '') + tzHours + ":"
			+ ((tzMins < 10) ? '0' : '') + tzMins;
	let dateTime = date + 'T' + time + timezone;

	// let dataAsJson = btoa(unescape(encodeURIComponent(PedigreeExport
	// 		.exportAsSimpleJSON(pedigree, privacySetting))));

	// let pedigreeExtension = {
	// 	"url" : "https://github.com/aehrc/panogram/panogram-data-extension",
	// 	"valueAttachment" : {
	// 		"contentType" : "application/json",
	// 		"data" : dataAsJson
	// 	}
	// };

	let patientReference = {
		"type" : "Patient",
		"reference" : fhirPatientReference ? fhirPatientReference : "#pat"
	};

	let containedResources = [];

	let patientEntries = [];
	let patientSection = {
		"title" : "Patient Condition",
		"entry" : patientEntries
	};

	let familyHistoryEntries = [];
	let familyHistorySection = {
		"title" : "Family History",
		"code" : {
			"coding" : {
				"system" : "http://loinc.org",
				"code" : "10157-6",
				"display" : "History of family member diseases"
			}
		},
		"entry" : familyHistoryEntries
	};

	let fhr_json = {
		"resourceType" : "Composition",
		"status" : "preliminary",
		"type" : {
			"coding" : {
				"system" : "http://loinc.org",
				"code" : "11488-4",
				"display" : "Consult note"
			}
		},
		"subject" : patientReference,
		"date" : dateTime,
		"title" : "Pedigree Details",
		// "extension" : [ pedigreeExtension ],
		"section" : [ patientSection, familyHistorySection ],
		"contained" : containedResources
	};


	if (!fhirPatientReference){
		let fhirPatient = this.buildFhirPatient("pat", pedigree.GG.properties[0],
				privacySetting);

		containedResources.push(fhirPatient);
	}

	if (pedigree.GG.properties[0]['disorders']) {
		let disorders = pedigree.GG.properties[0]['disorders'];
		let disorderLegend = editor.getDisorderLegend();
		// let disorderSystem = 'http://www.omim.org';
		let disorderSystem = TerminologyManager.getCodeSystem(DisorderTermType);//editor.getDisorderSystem();
		for (let i = 0; i < disorders.length; i++) {
			let disorderTerm = disorderLegend.getTerm(disorders[i]);
			let fhirCondition = null;
			if (disorderTerm.getName() === disorders[i]){
				// name and ID the same, must not be from omim
				fhirCondition = {
						"resourceType" : "Condition",
						"id" : "cond_" + i,
						"subject" : patientReference,
						"code" : {
								"text" : disorders[i]
						}
					};
			}
			else {
				// disorder from omim
				fhirCondition = {
						"resourceType" : "Condition",
						"id" : "cond_" + i,
						"subject" : patientReference,
						"code" : {
								"coding" : [
									{
										"system" : disorderSystem,
										"code" : disorders[i],
										"display" : disorderTerm.getName()
									}
								]
						}
					};
			}

			containedResources.push(fhirCondition);
			patientEntries.push({
				"type" : "Condition",
				"reference" : "#" + fhirCondition.id
			});
		}
	}

	let roleCache = [];
	roleCache[0] = "ONESELF";

	for (let i = 1; i <= pedigree.GG.getMaxRealVertexId(); i++) {
		if (!pedigree.GG.isPerson(i))
			continue;
		roleCache[i] = "";
	}
	this.fillRoleCache(roleCache, pedigree);

	for (let i = 0; i <= pedigree.GG.getMaxRealVertexId(); i++) {
		if (!pedigree.GG.isPerson(i))
			continue;

		let fmhResource = this.buildFhirFMH(i, pedigree, privacySetting,
				roleCache[i], patientReference);

		containedResources.push(fmhResource);

		familyHistoryEntries.push({
			"type" : "FamilyMemberHistory",
			"reference" : "#" + fmhResource.id
		});

		let nodeProperties = pedigree.GG.properties[i];
		let observations = [];
		if (nodeProperties['hpoTerms']) {
			let hpoTerms = nodeProperties['hpoTerms'];
			let hpoLegend = editor.getHPOLegend();
			// let hpoSystem = 'http://purl.obolibrary.org/obo/hp.owl';
			let hpoSystem =  TerminologyManager.getCodeSystem(PhenotypeTermType);

			for (let j = 0; j < hpoTerms.length; j++) {
				let fhirObservation = {
					"resourceType" : "Observation",
					"id" : "fmh_clinical_" + i + "_" + j,
					"status" : "preliminary",

				};
				let hpoTerm = hpoLegend.getTerm(hpoTerms[j]);
				if (hpoTerm.getName() === hpoTerms[j]){
					fhirObservation["valueString"] = hpoTerms[j]
				}
				else {
					fhirObservation["valueCodeableConcept"] = { "coding" : [ { "system" : hpoSystem, "code" : hpoTerms[i], "display" : hpoTerm.getName() } ] };
				}
				if (i === 0) {
					// we are talking about the patient
					fhirObservation['subject'] = patientReference;
				} else {
					fhirObservation['focus'] = {
						"type" : "FamilyMemberHistory",
						"reference" : "#" + fmhResource.id
					};
				}
				observations.push(fhirObservation);
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
					"resourceType" : "Observation",
					"id" : "fmh_genes_" + i + "_" + j,
					"status" : "preliminary",
				};
				let geneTerm = geneLegend.getTerm(candidateGenes[j]);
				if (geneTerm.getName() === candidateGenes[j]){
					fhirObservation["valueString"] = candidateGenes[j]
				}
				else {
					fhirObservation["valueCodeableConcept"] = { "coding" : [ { "system" : geneSystem, "code" : candidateGenes[i], "display" : geneTerm.getName() } ] };
				}
				if (i === 0) {
					// we are talking about the patient
					fhirObservation['subject'] = patientReference;
				} else {
					fhirObservation['focus'] = {
						"type" : "FamilyMemberHistory",
						"reference" : "#" + fmhResource.id
					};
				}
				observations.push(fhirObservation);
			}
		}

		if (observations.length > 0) {
			let ex = fmhResource['extension'];
			if (!ex) {
				ex = [];
				fmhResource['extension'] = ex;
			}
			for (let j = 0; j < observations.length; j++) {
				containedResources.push(observations[j]);
				let observationRef = {
					"type" : "Observation",
					"reference" : "#" + observations[j].id
				};

				ex
						.push({
							"url" : "http://hl7.org/fhir/StructureDefinition/family-member-history-genetics-observation",
							"valueReference" : observationRef
						});
				if (i === 0) {
					patientEntries.push(observationRef);
				} else {
					familyHistoryEntries.push(observationRef);
				}
			}
		}

	}

	return JSON.stringify(fhr_json, null, 2);
};

FHIRConverter.fillRoleCache = function(roleCache, pedigree) {

	let isAdopted = pedigree.GG.isAdopted(0);
	let parents = pedigree.GG.getParents(0);

	let mother = pedigree.GG.getMother(0) || -1;
	let father = pedigree.GG.getFather(0) || -2;

	if (mother < 0 || father < 0) {
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
		roleCache[mother] = (isAdopted) ? "ADOPTMTH" : "NMTH";
		this.fillParents(roleCache, pedigree, "M", "GR", mother);
	}
	if (father > 0) {
		roleCache[father] = (isAdopted) ? "ADOPTFTH" : "NFTH";
		this.fillParents(roleCache, pedigree, "F", "GR", father);
	}
	for (let i = 0; i < parents.length; i++) {
		if (roleCache[parents[i]] === "") {
			roleCache[parents[i]] = (isAdopted) ? "ADOPTPRN" : "NPRN";
			this.fillParents(roleCache, pedigree, "", "GR", parents[i]);
		}
	}
	// add partners and parents inlaw
	let partners = pedigree.GG.getAllPartners(0);
	for (let i = 0; i < partners.length; i++) {
		// console.log("Setting " + partners[i] + " to SIGOTHR : partners = "
		// 		+ partners);
		roleCache[partners[i]] = "SIGOTHR";
		let inlawParents = pedigree.GG.getParents(partners[i]);

		let inlawMother = pedigree.GG.getMother(partners[i]) || -1;
		let inlawFather = pedigree.GG.getFather(partners[i]) || -2;

		if (inlawMother < 0 || inlawFather < 0) {
			// could be no gender

			if (inlawParents.length > 0) {
				if (inlawMother === inlawParents[0]) {
					inlawFather = inlawParents[1];
				} else if (inlawMother === inlawParents[1]) {
					inlawFather = inlawParents[0];
				} else if (father === inlawParents[0]) {
					inlawMother = inlawParents[1];
				} else if (father === inlawParents[1]) {
					inlawMother = inlawParents[0];
				}
			}
		}
		if (inlawMother > 0) {
			roleCache[inlawMother] = "MTHINLAW";
		}
		if (inlawFather > 0) {
			roleCache[inlawFather] = "FTHINLAW";
		}
		for (let j = 0; j < inlawParents.length; i++) {
			if (roleCache[inlawParents[j]] === "") {
				roleCache[inlawParents[j]] = "PRNINLAW";
			}
		}
	}

	for (let i = 0; i < parents.length; i++) {
		this.fillStepParents(roleCache, pedigree, parents[i]);
	}

	let stillToProcess = [];
	let nextIteration = [];
	for (let i = 0; i <= pedigree.GG.getMaxRealVertexId(); i++) {
		if (!pedigree.GG.isPerson(i))
			continue;
		if (roleCache[i] === "") {
			stillToProcess.push(i);
		}
	}
	while (stillToProcess.length > 0) {
		let arrayLength = stillToProcess.length;
		for (let i = 0; i < arrayLength; i++) {
			if (!this.fillExtended(roleCache, pedigree, stillToProcess[i])) {
				nextIteration.push(i);
			}
		}
		if (arrayLength === nextIteration.length) {
			// nothing changed - need to stop
			break;
		}
		stillToProcess = nextIteration;
		nextIteration = [];
	}
};

FHIRConverter.fillParents = function(roleCache, pedigree, modifier, level, node) {
	let parents = pedigree.GG.getParents(node);

	if (parents.length === 0) {
		return;
	}

	let mother = pedigree.GG.getMother(node) || -1;
	let father = pedigree.GG.getFather(node) || -2;

	if (mother < 0 || father < 0) {
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
		roleCache[mother] = modifier + level + "MTH";
		this.fillParents(roleCache, pedigree, modifier, "G" + level, mother);
	}
	if (father > 0) {
		roleCache[father] = modifier + level + "FTH";
		this.fillParents(roleCache, pedigree, modifier, "G" + level, father);
	}
	for (let i = 0; i < parents.length; i++) {
		if (roleCache[parents[i]] === "") {
			roleCache[parents[i]] = modifier + level + "PRN";
			this.fillParents(roleCache, pedigree, modifier, "G" + level,
					parents[i]);
		}
	}
};

FHIRConverter.fillStepParents = function(roleCache, pedigree, node) {

	let thisRole = roleCache[node];
	let genderSlice = thisRole.slice(-3);

	let partners = pedigree.GG.getAllPartners(node);

	if (partners.length <= 1) {
		return;
	}
	let roleToSet = "STPPRN";
	if (genderSlice === "MTH") {
		roleToSet = "STPFTH";
	} else if (genderSlice === "FTH") {
		roleToSet = "STPMTH";
	}

	for (let i = 0; i < partners.length; i++) {
		if (roleCache[partners[i]] === "") {
			roleCache[partners[i]] = roleToSet;
		}
	}
};

FHIRConverter.fillExtended = function(roleCache, pedigree, node) {
	if (roleCache[node] !== "") {
		return true; // has a result;
	}
	// console.log("Attempt to classify node - " + node + " - "
	// 		+ pedigree.GG.properties[node]['comments']);
	let parents = pedigree.GG.getParents(node);

	if (parents.length === 0) {
		// console.log("No parents, can't classify");
		return false; // this node must be a parent of someone else
	}

	let p1Role = roleCache[parents[0]];
	let p2Role = roleCache[parents[1]];
	if (p1Role === "" && p2Role === "") {
		// console.log("Parents not classified, can't classify");
		return false;
	}

	let pGender = pedigree.GG.properties[0]['gender'];
	let vGender = pedigree.GG.properties[node]['gender'];

	let roleToSet = "";

	// check for children
	if (p1Role === "ONESELF" || p2Role === "ONESELF") {
		let isAdopted = pedigree.GG.isAdopted(node);
		switch (vGender) {
		case "F":
			roleToSet = (isAdopted) ? "DAUADOPT" : "DAU";
			break;
		case "M":
			roleToSet = (isAdopted) ? "SONADOPT" : "SON";
			break;
		default:
			roleToSet = (isAdopted) ? "CHLDADOPT" : "NCHILD";
		}
		roleCache[node] = roleToSet;
		// console.log("Child of ONESELF set to " + roleToSet);

		// add inlaws
		let inlaws = pedigree.GG.getAllPartners(node);
		if (inlaws.length > 0) {
			switch (vGender) {
			case "F":
				roleToSet = "SONINLAW";
				break;
			case "M":
				roleToSet = "DAUINLAW";
				break;
			default:
				roleToSet = "CHLDINLAW";
				break;
			}
			for (let i = 0; i < inlaws.length; i++) {
				if (roleCache[inlaws[i]] === "") {
					roleCache[inlaws[i]] = roleToSet;
				}
			}
		}

		return true;
	}
	// check partners children
	if (p1Role === "SIGOTHR" || p2Role === "SIGOTHR") {
		let isAdopted = pedigree.GG.isAdopted(node);
		switch (vGender) {
		case "F":
			roleToSet = (isAdopted) ? "DAUADOPT" : "STPDAU";
			break;
		case "M":
			roleToSet = (isAdopted) ? "SONADOPT" : "STPSON";
			break;
		default:
			roleToSet = (isAdopted) ? "CHLDADOPT" : "STPCHLD";
		}
		roleCache[node] = roleToSet;
		// console.log("Child of SIGOTHR set to " + roleToSet);

		// add inlaws
		let inlaws = pedigree.GG.getAllPartners(node);
		if (inlaws.length > 0) {
			switch (vGender) {
			case "F":
				roleToSet = "SONINLAW";
				break;
			case "M":
				roleToSet = "DAUINLAW";
				break;
			default:
				roleToSet = "CHLDINLAW";
				break;
			}
			for (let i = 0; i < inlaws.length; i++) {
				if (roleCache[inlaws[i]] === "") {
					roleCache[inlaws[i]] = roleToSet;
				}
			}
		}
		return true;
	}

	// check for siblings

	let nPrnCount = 0;
	if (p1Role === "NFTH" || p1Role === "NMTH" || p1Role === "NPRN") {
		nPrnCount++;
	}
	if (p2Role === "NFTH" || p2Role === "NMTH" || p2Role === "NPRN") {
		nPrnCount++;
	}

	if (nPrnCount === 2) {
		if (pedigree.GG.properties[0].hasOwnProperty('twinGroup')
				&& pedigree.GG.properties[node].hasOwnProperty('twinGroup')
				&& pedigree.GG.properties[0]['twinGroup'] === pedigree.GG.properties[node]['twinGroup']) {
			// appear to be twins
			if (pGender === "U" || vGender === "U" || vGender === pGender) {
				switch (vGender) {
				case "F":
					roleToSet = "TWINSIS";
					break;
				case "M":
					roleToSet = "TWINBRO";
					break;
				default:
					roleToSet = "TWIN";
					break;
				}
			} else { // genders are different
				switch (vGender) {
				case "F":
					roleToSet = "FTWINSIS";
					break;
				case "M":
					roleToSet = "FTWINBRO";
					break;
				default:
					// should never enter here
					roleToSet = "TWIN";
					break;
				}
			}
		} else {
			switch (vGender) {
			case "F":
				roleToSet = "NSIS";
				break;
			case "M":
				roleToSet = "NBRO";
				break;
			default:
				roleToSet = "NSIB";
				break;
			}
		}
		// console.log("Parents are both NPRN set to " + roleToSet);
	} else if (nPrnCount === 1) {
		// one common natural parent
		switch (vGender) {
		case "F":
			roleToSet = "HSIS";
			break;
		case "M":
			roleToSet = "HBRO";
			break;
		default:
			roleToSet = "HSIB";
			break;
		}
		// console.log("One Parent is  NPRN set to " + roleToSet);
	}

	if (roleToSet === "") {
		// check step siblings
		if (p1Role === "STPFTH" || p1Role === "STPMTH" || p1Role === "STPPRN"
				|| p2Role === "STPFTH" || p2Role === "STPMTH"
				|| p2Role === "STPPRN") {
			// child of step parent
			switch (vGender) {
			case "F":
				roleToSet = "STPSIS";
				break;
			case "M":
				roleToSet = "STPBRO";
				break;
			default:
				roleToSet = "STPSIB";
				break;
			}
			// console.log("One Parent is  STPPRN set to " + roleToSet);
		}
	}

	if (roleToSet !== "") {
		roleCache[node] = roleToSet;
		// add inlaws
		let inlaws = pedigree.GG.getAllPartners(node);
		if (inlaws.length > 0) {
			switch (vGender) {
			case "F":
				roleToSet = "BROINLAW";
				break;
			case "M":
				roleToSet = "SISINLAW";
				break;
			default:
				roleToSet = "SIBINLAW";
				break;
			}
			for (let i = 0; i < inlaws.length; i++) {
				if (roleCache[inlaws[i]] === "") {
					roleCache[inlaws[i]] = roleToSet;
				}
			}
		}
		return true;
	}

	// check children of children
	let childrenRoles = [ "DAUADOPT", "DAU", "SONADOPT", "SON", "CHLDADOPT",
			"NCHILD", "DAUADOPT", "STPDAU", "SONADOPT", "STPSON", "STPCHLD" ];
	if (childrenRoles.includes(p1Role) || childrenRoles.includes(p2Role)) {
		// parent is child
		switch (vGender) {
		case "F":
			roleToSet = "GRNDDAU";
			break;
		case "M":
			roleToSet = "GRNDSON";
			break;
		default:
			roleToSet = "GRNDCHILD";
			break;
		}
		roleCache[node] = roleToSet;
		// console.log("One Parent is CHILD set to " + roleToSet);
		return true;
	}

	// check children of siblings
	let siblingRoles = [ "TWINSIS", "TWINBRO", "TWIN", "FTWINSIS", "FTWINBRO",
			"NSIS", "NBRO", "NSIB", "HSIS", "HBRO", "HSIB", "STPSIS", "STPBRO",
			"STPSIB" ];
	if (siblingRoles.includes(p1Role) || siblingRoles.includes(p2Role)) {
		// parent is sibling
		switch (vGender) {
		case "F":
			roleToSet = "NIECE";
			break;
		case "M":
			roleToSet = "NEPHEW";
			break;
		default:
			roleToSet = "NIENEPH";
			break;
		}
		roleCache[node] = roleToSet;
		// console.log("One Parent is SIBLING set to " + roleToSet);
		return true;
	}

	// check children of grand children
	let gcRegex = /(G)*GRND((DAU)|(SON)|(CHILD))/;
	let p1Match = gcRegex.exec(p1Role);
	let p2Match = gcRegex.exec(p2Role);

	hasMatch = true;
	depth = "";
	if (p1Match != null && p2Match != null) {
		let depth1 = p1Match[1] || "";
		let depth2 = p2Match[1] || "";
		if (depth1.length < depth2.length) {
			depth = depth1;
		} else {
			depth = depth2;
		}
	} else if (p1Match != null) {
		depth = p1Match[1] || "";
	} else if (p2Match != null) {
		depth = p2Match[1] || "";
	} else {
		hasMatch = false;
	}

	if (hasMatch) {
		// parent is grandchild
		switch (vGender) {
		case "F":
			roleToSet = depth + "GGRNDDAU";
			break;
		case "M":
			roleToSet = depth + "GGRNDSON";
			break;
		default:
			roleToSet = depth + "GGRNDCHILD";
			break;
		}
		roleCache[node] = roleToSet;
		// console.log("One Parent is GRANDCHILD set to " + roleToSet);
		return true;
	}

	// check children of grand parents
	let grRegex = /([MP])?(G)*GR(([FM]TH)|(PRN))/;
	p1Match = grRegex.exec(p1Role);
	p2Match = grRegex.exec(p2Role);

	let mOrP = "";
	let depth = "";
	let hasMatch = true;

	if (p1Match != null && p2Match != null) {
		let mOrP1 = p1Match[1] || "";
		let mOrP2 = p2Match[1] || "";
		if (mOrP1 === mOrP2) {
			mOrP = mOrP1;
		} else if (mOrP1 === "") {
			mOrP = mOrP2;
		} else if (mOrP2 === "") {
			mOrP = mOrP1;
		} else {
			mOrP = "";
		}
		let depth1 = p1Match[2] || "";
		let depth2 = p2Match[2] || "";
		if (depth1.length > depth2.length) {
			depth = depth1;
		} else {
			depth = depth2;
		}
	} else if (p1Match != null) {
		mOrP = p1Match[1] || "";
		depth = p1Match[2] || "";
	} else if (p2Match != null) {
		mOrP = p2Match[1] || "";
		depth = p2Match[2] || "";
	} else {
		hasMatch = false;
	}

	if (hasMatch) {
		// parent is grandparant
		switch (vGender) {
		case "F":
			roleToSet = mOrP + depth + "AUNT";
			break;
		case "M":
			roleToSet = mOrP + depth + "UNCLE";
			break;
		default:
			// there is no gender neutral word
			roleToSet = mOrP + depth + "PIBLING";
			break;
		}
		roleCache[node] = roleToSet;
		// console.log("One Parent is GRANDPARENT set to " + roleToSet);
		return true;
	}

	// check children of PIBLINGS
	let piblingRegex = /([MP])?(G)*((AUNT)|(UNCLE)|(PIBLING))/;
	p1Match = piblingRegex.exec(p1Role);
	p2Match = piblingRegex.exec(p2Role);

	mOrP = "";
	depth = "";
	hasMatch = true;

	if (p1Match != null && p2Match != null) {
		let mOrP1 = p1Match[1] || "";
		let mOrP2 = p2Match[1] || "";
		if (mOrP1 === mOrP2) {
			mOrP = mOrP1;
		} else if (mOrP1 === "") {
			mOrP = mOrP2;
		} else if (mOrP2 === "") {
			mOrP = mOrP1;
		} else {
			mOrP = "";
		}
		let depth1 = p1Match[2] || "";
		let depth2 = p2Match[2] || "";
		if (depth1.length > depth2.length) {
			depth = depth1;
		} else {
			depth = depth2;
		}
	} else if (p1Match != null) {
		mOrP = p1Match[1] || "";
		depth = p1Match[2] || "";
	} else if (p2Match != null) {
		mOrP = p2Match[1] || "";
		depth = p2Match[2] || "";
	} else {
		hasMatch = false;
	}

	if (hasMatch) {
		// parent is PIBLING(aunt or uncle)
		// cousins are gender neutral
		roleCache[node] = mOrP + "COUSN";
		// console.log("One Parent is PIBLING set to " + roleToSet);
		return true;
	}

	// check children of niece/nephew

	let nnRegex = /(G)*((NIECE)|(NEPHEW)|(NIENEPH))/;
	p1Match = nnRegex.exec(p1Role);
	p2Match = nnRegex.exec(p2Role);

	hasMatch = true;
	depth = "";
	if (p1Match != null && p2Match != null) {
		let depth1 = p1Match[1] || "";
		let depth2 = p2Match[1] || "";
		if (depth1.length < depth2.length) {
			depth = depth1;
		} else {
			depth = depth2;
		}
	} else if (p1Match != null) {
		depth = p1Match[1] || "";
	} else if (p2Match != null) {
		depth = p2Match[1] || "";
	} else {
		hasMatch = false;
	}

	if (hasMatch) {
		// parent is grandchild
		switch (vGender) {
		case "F":
			roleToSet = depth + "GNIECE";
			break;
		case "M":
			roleToSet = depth + "GNEPHEW";
			break;
		default:
			roleToSet = depth + "GNIENEPH";
			break;
		}
		roleCache[node] = roleToSet;
		// console.log("One Parent is NIECE/NEPHEW set to " + roleToSet);
		return true;
	}

	// check children of COUSINS
	let cousinRegex = /([MP])?COUSN/;
	p1Match = cousinRegex.exec(p1Role);
	p2Match = cousinRegex.exec(p2Role);

	mOrP = "";
	hasMatch = true;

	if (p1Match != null && p2Match != null) {
		let mOrP1 = p1Match[1] || "";
		let mOrP2 = p2Match[1] || "";
		if (mOrP1 === mOrP2) {
			mOrP = mOrP1;
		} else if (mOrP1 === "") {
			mOrP = mOrP2;
		} else if (mOrP2 === "") {
			mOrP = mOrP1;
		} else {
			mOrP = "";
		}
	} else if (p1Match != null) {
		mOrP = p1Match[1] || "";
	} else if (p2Match != null) {
		mOrP = p2Match[1] || "";
	} else {
		hasMatch = false;
	}

	if (hasMatch) {
		// parent is COUSIN
		// cousins are gender neutral
		roleCache[node] = mOrP + "COUSN";
		// console.log("One Parent is COUSIN set to " + mOrP + "COUSN");
		return true;
	}

	// console.log("No match found - p1Role = " + p1Role + " p2Role = " + p2Role);
	return false;
};

FHIRConverter.familyHistoryLookup = {
	"notFound" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "EXT",
		"display" : "extended family member"
	},
	"ONESELF" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "ONESELF",
		"display" : "self"
	},
	"FAMMEMB" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "FAMMEMB",
		"display" : "family member"
	},
	"NMTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "NMTH",
		"display" : "natural mother"
	},
	"NFTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "NFTH",
		"display" : "natural father"
	},
	"NPRN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "NPRN",
		"display" : "natural parent"
	},
	"ADOPTMTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "ADOPTM",
		"display" : "adoptive mother"
	},
	"ADOPTFTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "ADOPTF",
		"display" : "adoptive father"
	},
	"ADOMPTPRN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "ADOPTP",
		"display" : "adoptive parent"
	},
	"DAU" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "DAU",
		"display" : "natural daughter"
	},
	"SON" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "SON",
		"display" : "natural son"
	},
	"NCHILD" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "NCHILD",
		"display" : "natural child"
	},
	"DAUADOPT" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "DAUADOPT",
		"display" : "adopted daughter"
	},
	"SONADOPT" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "SONADOPT",
		"display" : "adopted son"
	},
	"CHLDADOPT" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "CHLDADOPT",
		"display" : "adopted child"
	},
	"DAUINLAW" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "DAUINLAW",
		"display" : "daughter in-law"
	},
	"SONINLAW" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "SONINLAW",
		"display" : "son in-law"
	},
	"CHLDINLAW" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "CHLDINLAW",
		"display" : "child-in-law"
	},
	"SIGOTHR" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "SIGOTHR",
		"display" : "significant other"
	},
	"STPDAU" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "STPDAU",
		"display" : "stepdaughter"
	},
	"STPSON" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "STPSON",
		"display" : "stepson"
	},
	"STPCHLD" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "STPCHLD",
		"display" : "step child"
	},
	"TWINSIS" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "TWINSIS",
		"display" : "twin sister"
	},
	"TWINBRO" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "TWINBRO",
		"display" : "twin brother"
	},
	"TWIN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "TWIN",
		"display" : "twin"
	},
	"FTWINSIS" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "FTWINSIS",
		"display" : "fraternal twin sister"
	},
	"FTWINBRO" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "FTWINBRO",
		"display" : "fraternal twin brother"
	},
	"NSIS" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "NSIS",
		"display" : "natural sister"
	},
	"NBRO" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "NBRO",
		"display" : "natural brother"
	},
	"NSIB" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "NSIB",
		"display" : "natural sibling"
	},
	"HSIS" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "HSIS",
		"display" : "half-sister"
	},
	"HBRO" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "HBRO",
		"display" : "half-brother"
	},
	"HSIB" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "HSIB",
		"display" : "half-sibling"
	},
	"BROINLAW" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "BROINLAW",
		"display" : "brother-in-law"
	},
	"SISINLAW" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "SISINLAW",
		"display" : "sister-in-law"
	},
	"SIBINLAW" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "SIBINLAW",
		"display" : "sibling in-law"
	},
	"GRNDDAU" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "GRNDDAU",
		"display" : "granddaughter"
	},
	"GRNDSON" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "GRNDSON",
		"display" : "grandson"
	},
	"GRNDCHILD" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "GRNDCHILD",
		"display" : "grandchild"
	},
	"NIECE" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "NIECE",
		"display" : "niece"
	},
	"NEPHEW" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "NEPHEW",
		"display" : "nephew"
	},
	"NIENEPH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "NIENEPH",
		"display" : "niece/nephew"
	},
	"MCOUSN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "MCOUSN",
		"display" : "maternal cousin"
	},
	"PCOUSN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "PCOUSN",
		"display" : "paternal cousin"
	},
	"COUSN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "COUSN",
		"display" : "cousin"
	},
	"MTHINLAW" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "MTHINLAW",
		"display" : "mother-in-law"
	},
	"FTHINLAW" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "FTHINLAW",
		"display" : "father-in-law"
	},
	"PRNINLAW" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "PRNINLAW",
		"display" : "parent in-law"
	},
	"MAUNT" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "MAUNT",
		"display" : "maternal aunt"
	},
	"PAUNT" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "PAUNT",
		"display" : "paternal aunt"
	},
	"AUNT" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "AUNT",
		"display" : "aunt"
	},
	"MUNCLE" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "MUNCLE",
		"display" : "maternal uncle"
	},
	"PUNCLE" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "PUNCLE",
		"display" : "paternal uncle"
	},
	"UNCLE" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "UNCLE",
		"display" : "uncle"
	},
	"GGRPRN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "GGRPRN",
		"display" : "great grandparent"
	},
	"GGRFTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "GGRFTH",
		"display" : "great grandfather"
	},
	"MGGRFTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "MGGRFTH",
		"display" : "maternal great-grandfather"
	},
	"PGGRFTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "PGGRFTH",
		"display" : "paternal great-grandfather"
	},
	"GGRMTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "GGRMTH",
		"display" : "great grandmother"
	},
	"MGGRMTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "MGGRMTH",
		"display" : "maternal great-grandmother"
	},
	"PGGRMTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "PGGRMTH",
		"display" : "paternal great-grandmother"
	},
	"MGGRPRN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "MGGRPRN",
		"display" : "maternal great-grandparent"
	},
	"PGGRPRN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "PGGRPRN",
		"display" : "paternal great-grandparent"
	},
	"GRPRN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "GRPRN",
		"display" : "grandparent"
	},
	"GRFTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "GRFTH",
		"display" : "grandfather"
	},
	"MGRFTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "MGRFTH",
		"display" : "maternal grandfather"
	},
	"PGRFTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "PGRFTH",
		"display" : "paternal grandfather"
	},
	"GRMTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "GRMTH",
		"display" : "grandmother"
	},
	"MGRMTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "MGRMTH",
		"display" : "maternal grandmother"
	},
	"PGRMTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "PGRMTH",
		"display" : "paternal grandmother"
	},
	"MGRPRN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "MGRPRN",
		"display" : "maternal grandparent"
	},
	"PGRPRN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "PGRPRN",
		"display" : "paternal grandparent"
	},
	"STPMTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "STPMTH",
		"display" : "stepmother"
	},
	"STPFTH" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "STPFTH",
		"display" : "stepfather"
	},
	"STPPRN" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "STPPRN",
		"display" : "step parent"
	},
	"STPSIS" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "STPSIS",
		"display" : "stepsister"
	},
	"STPBRO" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "STPBRO",
		"display" : "stepbrother"
	},
	"STPSIB" : {
		"system" : "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
		"code" : "STPSIB",
		"display" : "step sibling"
	},
};

FHIRConverter.sexLookup = {
	"male" : {
		"system" : "http://hl7.org/fhir/administrative-gender",
		"code" : "male",
		"display" : "Male"
	},
	"female" : {
		"system" : "http://hl7.org/fhir/administrative-gender",
		"code" : "female",
		"display" : "Female"
	},
	"other" : {
		"system" : "http://hl7.org/fhir/administrative-gender",
		"code" : "other",
		"display" : "Other"
	},
	"unknown" : {
		"system" : "http://hl7.org/fhir/administrative-gender",
		"code" : "unknown",
		"display" : "Unknown"
	}
};

FHIRConverter.buildFhirPatient = function(containedId, properties,
										  idGenerationPreference) {
	let privacySetting = 'all';
	let patientResource = {
		"id" : containedId,
		"resourceType" : "Patient",
	};
	if (properties.gender) {
		if (properties.gender === "M") {
			patientResource.gender = "male";
		} else if (properties.gender === "F") {
			patientResource.gender = "female";
		} else {
			patientResource.gender = "unknown";
		}
	}
	if (properties.twinGroup) {
		patientResource.multipleBirthBoolean = true;
	}
	if (properties.dod && privacySetting !== "all") {
		patientResource.deceasedBoolean = true;
	}
	if (privacySetting === "all") {

		if (properties.dob) {
			let d = new Date(properties.dob);
			patientResource.birthDate = d.getFullYear() + '-'
					+ (d.getMonth() + 1) + '-' + d.getDate();
		}
		if (properties.dod) {
			let d = new Date(properties.dod);
			patientResource.deceasedDateTime = d.getFullYear() + '-'
					+ (d.getMonth() + 1) + '-' + d.getDate();
		}
		if (properties.lName || properties.fName || properties.lNameAtB) {
			patientResource.name = [];
			if (properties.lName || properties.fName) {
				let name = {};
				if (properties.lName) {
					name.family = properties.lName;
				}
				if (properties.fName) {
					name.given = [ properties.fName ];
				}
				patientResource.name.push(name);
			}
			if (properties.lNameAtB && properties.lNameAtB !== properties.lName  ) {
				let name = {
					"use" : "old",
					"family" : properties.lNameAtB
				};
				patientResource.name.push(name);
			}
		}
	}
	return patientResource;
};

FHIRConverter.buildGeneticsParentExtension = function(index, relationship) {

	let fullRelationship = FHIRConverter.familyHistoryLookup[relationship];
	let ref = "#FMH_" + index;

	return {
		"url" : "http://hl7.org/fhir/StructureDefinition/family-member-history-genetics-parent",
		"extension" : [ {
			"url" : "type",
			"valueCodeableConcept" : {
				"coding" : [ fullRelationship ]
			}
		}, {
			"url" : "reference",
			"valueReference" : {
				"reference" : ref
			}
		} ]
	};

};

FHIRConverter.buildFhirFMH = function(index, pedigree, privacySetting,
		relationship, patientRef) {

	let ref = "FMH_" + index;
	let nodeProperties = pedigree.GG.properties[index];

	let extensions = [];

	let isAdopted = pedigree.GG.isAdopted(index);
	let parents = pedigree.GG.getParents(index);

	let mother = pedigree.GG.getMother(index) || -1;
	let father = pedigree.GG.getFather(index) || -2;

	if (mother < 0 || father < 0) {
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
	for (let i = 0; i < parents.length; i++) {
		if (parents[i] === mother) {
			extensions.push(this.buildGeneticsParentExtension(parents[i],
					(isAdopted) ? "ADOPTMTH" : "NMTH"))
		} else if (parents[i] === father) {
			extensions.push(this.buildGeneticsParentExtension(parents[i],
					(isAdopted) ? "ADOPTFTH" : "NFTH"))
		} else {
			extensions.push(this.buildGeneticsParentExtension(parents[i],
					(isAdopted) ? "ADOPTPRN" : "NPRN"))

		}
	}
	let fullRelationship = FHIRConverter.familyHistoryLookup[relationship];
	if (!fullRelationship) {
		if (relationship) {
			fullRelationship = FHIRConverter.familyHistoryLookup["notFound"];
		} else {
			fullRelationship = FHIRConverter.familyHistoryLookup["FAMMEMB"];
		}
	}
	let name = "Family member " + index;
	if (privacySetting === "all") {
		let lname = nodeProperties['lName'] || "";
		let fname = nodeProperties['fName'] || "";
		if (lname && fname) {
			name = fname + " " + lname;
		}
		else if (lname){
			name = lname;
		}
		else if (fname){
			name = fname;
		}
		if (nodeProperties['lNameAtB'] && nodeProperties['lNameAtB'] !== lname) {
			name = name + " (" + nodeProperties['lNameAtB'] + ")";
		}
	}
	let sexCode = "unknown";
	if (nodeProperties['gender'] === "F") {
		sexCode = "female";
	}
	if (nodeProperties['gender'] === "M") {
		sexCode = "male";
	}

	let fmhResource = {
		"resourceType" : "FamilyMemberHistory",
		"id" : ref,
		"status" : "completed",
		"patient" : patientRef,
		"name" : name,
		"sex" : {
			"coding" : [ this.sexLookup[sexCode] ]
		},
		"relationship" : {
			"coding" : [ fullRelationship ]
		}
	};

	if (extensions.length > 0) {
		fmhResource['extension'] = extensions;
	}
	if (privacySetting === "all") {
		if (nodeProperties['dob']) {
			let d = new Date(nodeProperties['dob']);
			fmhResource['bornDate'] = d.getFullYear() + '-'
					+ (d.getMonth() < 9 ?'0' :'') + (d.getMonth() + 1) + '-' + (d.getDate() <= 9 ?'0' :'') + d.getDate();
		}
		if (nodeProperties['dod']) {
			let d = new Date(nodeProperties['dod']);
			fmhResource['deceasedDate'] = d.getFullYear() + '-'
				+ (d.getMonth() < 9 ?'0' :'') + (d.getMonth() + 1) + '-' + (d.getDate() <= 9 ?'0' :'') + d.getDate();
		}
	}
	if (privacySetting !== "minimal" && nodeProperties['comments']) {
		fmhResource['note'] = [ {
			"text" : nodeProperties['comments']
		} ];
	}
	if (nodeProperties['disorders']) {
		let disorders = nodeProperties['disorders'];
		let conditions = [];
		let disorderLegend = editor.getDisorderLegend();
		// let disorderSystem = 'http://www.omim.org';
		let disorderSystem = TerminologyManager.getCodeSystem(DisorderTermType);

		for (let i = 0; i < disorders.length; i++) {
			let disorderTerm = disorderLegend.getTerm(disorders[i]);
			if (disorderTerm.getName() === disorders[i]){
				// name and ID the same, must not be from omim
				conditions.push({
					"code" : {
						"text" : disorders[i]
					}
				});
			} else {
				conditions.push({
					"code" : {
						"coding" : [
							{
								"system" : disorderSystem,
								"code" : disorders[i],
								"display" : disorderTerm.getName()
							}
						]
					}
				});
			}
		}
		fmhResource['condition'] = conditions;
	}
	return fmhResource;

};

//===============================================================================================

export default FHIRConverter;