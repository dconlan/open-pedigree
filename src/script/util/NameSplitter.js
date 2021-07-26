
var NameSplitter = function () {
};

NameSplitter.prototype = {};


// do not include things that could also be first names, e.g. "dean"
// many of these from wikipedia: https://en.wikipedia.org/wiki/Title
// The parser recognizes chains of these including conjunctions allowing
// recognition titles like "Deputy Secretary of State"
const TITLES = [
  'dr','doctor','miss','misses','mr','mister','mrs','ms','sir','dame',
  'rev','madam','madame','ab','2ndlt','amn','1stlt','a1c','capt','sra','maj',
  'ssgt','ltcol','tsgt','col','briggen','1stsgt','majgen','smsgt','ltgen',
  '1stsgt','cmsgt','1stsgt','ccmsgt','cmsaf','pvt','2lt','pv2','1lt',
  'pfc','cpt','spc','maj','cpl','ltc','sgt','ssg','bg','sfc','mg',
  'msg','ltg','1sgt','sgm','csm','sma','wo1','wo2','wo3','wo4','wo5',
  'ens','sa','ltjg','sn','lt','po3','lcdr','po2','cdr','po1','cpo',
  'radm(lh)','scpo','radm(uh)','mcpo','vadm','mcpoc','adm','mpco-cg',
  'pvt','2ndlt','pfc','1stlt','lcpl','cpl','sgt','ssgt','gysgt','bgen','msgt',
  'majgen','1stsgt','ltgen','mgysgt',
  'gen','sgtmaj','sgtmajmc','wo-1','cwo-2','cwo-3','cwo-4','cwo-5',
  'rdml','radm','mcpon','fadm','wo1','cwo2','cwo3','cwo4','cwo5',
  'rt','lord','lady','duke','dutchess','master','maid','uncle','auntie','aunt',
  'representative','senator','king','queen','cardinal','secretary','state',
  'foreign','minister','speaker','president','deputy','executive','vice',
  'councillor','alderman','delegate','mayor','lieutenant','governor','prefect',
  'prelate','premier','burgess','ambassador','envoy','secretary', 'attaché',
  'chargé d\'affaires','provost','marquis','marquess','marquise','marchioness',
  'archduke','archduchess','viscount','baron','emperor','empress','tsar',
  'tsarina','leader','abbess','abbot','brother','sister','friar','mother',
  'superior','reverend','bishop','archbishop','metropolitan','presbyter',
  'priest','high','priestess','father','patriarch','pope','catholicos',
  'vicar','chaplain','canon','pastor','prelate','primate','chaplain',
  'cardinal','servant','venerable','blessed','saint','member','solicitor',
  'mufti','grand','chancellor','barrister','bailiff','attorney','advocate',
  'deacon','archdeacon','acolyte','elder','minister','monsignor','almoner',
  'prof','colonel','general','commodore','air','corporal','staff','mate',
  'chief','first','sergeant','sergeant','admiral','high','rear','brigadier',
  'captain','group','commander','commander-in-chief','wing','general',
  'adjutant','director','generalissimo','resident','surgeon','officer',
  'academic','analytics','business','credit','financial','information',
  'security','knowledge','marketing','operating','petty','risk','security',
  'strategy','technical','warrant','corporate','customs','field','flag',
  'flying','intelligence','pilot','police','political','revenue','senior',
  'staff','private','principal','coach','nurse','nanny','docent','lama',
  'druid','archdruid','rabbi','rebbe','buddha','ayatollah','imam',
  'bodhisattva','mullah','mahdi','saoshyant','tirthankar','vardapet',
  'pharaoh','sultan','sultana','maharajah','maharani','elder',
  'vizier','chieftain','comptroller','courtier','curator','doyen','edohen',
  'ekegbian','elerunwon','forester','gentiluomo','headman','intendant',
  'lamido','marcher','matriarch','patriarch','prior','pursuivant','rangatira',
  'ranger','registrar','seigneur','sharif','shehu','sheikh','sheriff','subaltern',
  'subedar','sysselmann','timi','treasurer','verderer','warden','hereditary',
  'woodman','bearer','banner','swordbearer','apprentice','journeyman',
  'adept','akhoond','arhat','bwana','goodman','goodwife','bard','hajji','mullah',
  'baba','effendi','giani','gyani','guru','siddha','pir','murshid',
  'attache','prime','united','states','national','associate','assistant',
  'supreme','appellate','judicial','queen\'s','king\'s','bench','right','majesty',
  'his','her','kingdom','royal',
];


// PUNC_TITLES could be names or titles, but if they have period at the end they're a title
const PUNC_TITLES = ['hon.'];

// words that prefix last names. Can be chained like "de la Vega"
// these should not be more common as first or middle names than prefixes
const PREFIXES = [
  'abu','bon','bin','da','dal','de','del','der','de','di','dí','ibn',
  'la','le','san','st','ste','van','vel','von'
];

const SUFFIXES = [
  'esq','esquire','jr','sr','2','i','ii','iii','iv','v','clu','chfc',
  'cfp','md','phd', 'm.d.', 'ph.d.', '2nd', '3rd', '4th', '5th'
];

const CONJUNCTIONS = ['&','and','et','e','of','the','und','y',];


NameSplitter.split = function (name) {
  if (name.includes(',')){
    return NameSplitter.splitWithComma(name);
  }
  return NameSplitter.splitNoComma(name);
};

NameSplitter.splitNoComma = function (name) {

  let regex =/^([^(]*)(\(([^)]*)\))?([^(]*)(\(([^)]*)\))?$/;
  let nameSplit = regex.exec(name);

  // console.log(nameSplit);
  if (nameSplit == null) {
    // way too complex
    return {first: [name]};
  }
  let result = {};
  let namesToSplit = nameSplit[1].trim();
  if (nameSplit[3] && nameSplit[3].trim().length > 0) {
    if (nameSplit[4] && nameSplit[4].trim().length > 0){
      result.nickname = nameSplit[3].trim();
    } else {
      result.maiden = nameSplit[3].trim();
    }
  }
  if (nameSplit[4] && nameSplit[4].trim().length > 0) {
    namesToSplit = namesToSplit + ' ' + nameSplit[4].trim();
  }
  if (nameSplit[6] && nameSplit[6].trim().length > 0) {
    result.maiden = nameSplit[6].trim();
  }
  let names = namesToSplit.split(/\s+/);
  if (names.length == 1){
    // a single name, make it the first
    return {first: [name]};
  }

  // remove any titles.
  let title = [];
  let titleOffset = 0;
  while (titleOffset < names.length){
    const nameToTest = names[titleOffset].toLowerCase();
    if (TITLES.includes(nameToTest) || PUNC_TITLES.includes(nameToTest)
        || CONJUNCTIONS.includes(nameToTest)){
      title.push(names[titleOffset]);
    } else {
      break;
    }
    titleOffset++;
  }
  if (title.length > 0) {
    result.title = title.join(' ');
  }

  // remove suffix.
  let suffix = [];
  let suffixIndex = names.length - 1;
  while (suffixIndex > titleOffset){

    const nameToTest = names[suffixIndex].toLowerCase();
    if (SUFFIXES.includes(nameToTest)){
      suffix.unshift(names[suffixIndex]);
    } else {
      break;
    }
    suffixIndex--;
  }
  if (suffix.length > 0){
    result.suffix = suffix;
  }
  if (suffixIndex > titleOffset){
    let surname = [names[suffixIndex]];

    let surnameIndex = suffixIndex - 1;
    while (surnameIndex >= titleOffset){

      const nameToTest = names[surnameIndex].toLowerCase();
      if (PREFIXES.includes(nameToTest)){
        surname.unshift(names[surnameIndex]);
      } else {
        break;
      }
      surnameIndex--;
    }
    if (surname.length > 0){
      result.surname = surname.join(' ');
    }
    let firstNames = [];
    for (let i = titleOffset; i <= surnameIndex; i++ ){
      firstNames.push(names[i]);
    }
    if (firstNames.length > 0){
      result.first = firstNames;
    }
  }
  return result;
};

NameSplitter.splitWithComma = function (name) {
  let result = {};
  let nameSplit = name.split(',');

  let surnames = nameSplit[0].trim().split(/\s+/);

  // remove suffix.
  let suffix = [];
  let suffixIndex = surnames.length - 1;
  while (suffixIndex > 0){

    const nameToTest = surnames[suffixIndex].toLowerCase();
    if (SUFFIXES.includes(nameToTest)){
      suffix.unshift(surnames[suffixIndex]);
    } else {
      break;
    }
    suffixIndex--;
  }
  if (suffix.length > 0){
    result.suffix = suffix;
  }
  let surname = [];
  for (let i = 0; i <= suffixIndex; i++ ){
    surname.push(surnames[i]);
  }
  if (surname.length > 0){
    result.surname = surname.join(' ');
  }
  result.first = nameSplit[1].trim().split(/\s+/);

  return result;
};



// console.log(NameSplitter.split('Sir David Attenborough'));
// console.log(NameSplitter.split('Dr Hans de Vissier'));
// console.log(NameSplitter.split('Hans de Vissier Jr'));
// console.log(NameSplitter.split('Mary Ridout (Conlan)'));
// console.log(NameSplitter.split('John (The Dude) Smith'));
// console.log(NameSplitter.split('Mary (Rosie) Ridout (Conlan)'));
// console.log(NameSplitter.split('Mary Rose Conlan'));
// console.log(NameSplitter.split('Pitt the younger'));
// console.log(NameSplitter.split('de Vissier Jr, Hans'));
// console.log(NameSplitter.split("Dave"));
//===============================================================================================

export default NameSplitter;
