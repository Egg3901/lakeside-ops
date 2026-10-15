/**
 * Election Map Page — reads pre-built HTML and injects embedded data
 */
const fs = require("fs");
const path = require("path");

// ─── Build embedded JSON data once ────────────────────────────────
const raw2019 = {
  CT:{race:{white:66,black:12,hispanic:17,asian:5,other:0},educ:{no_college:52,college:30,graduate:18},wealth:{low:22,middle:52,high:26},age:{young:22,mid:25,mature:27,senior:26},ideo:{evangelicals:6,environmentalists:16,libertarians:5,progressives:23,patriots:3,gunowners:5}},
  DE:{race:{white:62,black:23,hispanic:10,asian:4,other:1},educ:{no_college:56,college:30,graduate:14},wealth:{low:26,middle:52,high:22},age:{young:23,mid:25,mature:26,senior:26},ideo:{evangelicals:6,environmentalists:17,libertarians:5,progressives:23,patriots:4,gunowners:5}},
  MA:{race:{white:71,black:9,hispanic:12,asian:7,other:1},educ:{no_college:48,college:30,graduate:22},wealth:{low:22,middle:50,high:28},age:{young:24,mid:26,mature:26,senior:24},ideo:{evangelicals:5,environmentalists:18,libertarians:4,progressives:23,patriots:4,gunowners:5}},
  MD:{race:{white:50,black:31,hispanic:11,asian:7,other:1},educ:{no_college:50,college:30,graduate:20},wealth:{low:22,middle:52,high:26},age:{young:24,mid:27,mature:27,senior:22},ideo:{evangelicals:8,environmentalists:16,libertarians:4,progressives:24,patriots:4,gunowners:5}},
  ME:{race:{white:93,black:2,hispanic:2,asian:1,other:2},educ:{no_college:58,college:28,graduate:14},wealth:{low:28,middle:54,high:18},age:{young:20,mid:23,mature:28,senior:29},ideo:{evangelicals:7,environmentalists:17,libertarians:7,progressives:18,patriots:5,gunowners:8}},
  NH:{race:{white:90,black:2,hispanic:4,asian:3,other:1},educ:{no_college:52,college:32,graduate:16},wealth:{low:20,middle:54,high:26},age:{young:21,mid:25,mature:28,senior:26},ideo:{evangelicals:6,environmentalists:15,libertarians:9,progressives:17,patriots:5,gunowners:9}},
  NJ:{race:{white:54,black:15,hispanic:21,asian:10,other:0},educ:{no_college:50,college:30,graduate:20},wealth:{low:22,middle:50,high:28},age:{young:23,mid:26,mature:27,senior:24},ideo:{evangelicals:6,environmentalists:16,libertarians:5,progressives:23,patriots:4,gunowners:5}},
  NY:{race:{white:54,black:18,hispanic:19,asian:9,other:0},educ:{no_college:52,college:28,graduate:20},wealth:{low:28,middle:48,high:24},age:{young:24,mid:27,mature:26,senior:23},ideo:{evangelicals:7,environmentalists:16,libertarians:4,progressives:22,patriots:4,gunowners:6}},
  PA:{race:{white:76,black:12,hispanic:8,asian:4,other:0},educ:{no_college:58,college:28,graduate:14},wealth:{low:26,middle:54,high:20},age:{young:22,mid:24,mature:27,senior:27},ideo:{evangelicals:12,environmentalists:8,libertarians:6,progressives:12,patriots:7,gunowners:11}},
  RI:{race:{white:71,black:8,hispanic:16,asian:4,other:1},educ:{no_college:54,college:30,graduate:16},wealth:{low:26,middle:52,high:22},age:{young:24,mid:26,mature:26,senior:24},ideo:{evangelicals:5,environmentalists:17,libertarians:5,progressives:22,patriots:3,gunowners:5}},
  VT:{race:{white:93,black:1,hispanic:2,asian:2,other:2},educ:{no_college:52,college:30,graduate:18},wealth:{low:26,middle:54,high:20},age:{young:22,mid:24,mature:28,senior:26},ideo:{evangelicals:5,environmentalists:21,libertarians:6,progressives:23,patriots:4,gunowners:7}},
  AL:{race:{white:65,black:27,hispanic:5,asian:2,other:1},educ:{no_college:64,college:26,graduate:10},wealth:{low:34,middle:50,high:16},age:{young:24,mid:25,mature:27,senior:24},ideo:{evangelicals:38,environmentalists:2,libertarians:4,progressives:4,patriots:18,gunowners:22}},
  AR:{race:{white:72,black:16,hispanic:8,asian:2,other:2},educ:{no_college:66,college:24,graduate:10},wealth:{low:34,middle:52,high:14},age:{young:24,mid:25,mature:26,senior:25},ideo:{evangelicals:36,environmentalists:2,libertarians:5,progressives:4,patriots:17,gunowners:21}},
  FL:{race:{white:53,black:17,hispanic:26,asian:3,other:1},educ:{no_college:58,college:28,graduate:14},wealth:{low:28,middle:50,high:22},age:{young:22,mid:24,mature:26,senior:28},ideo:{evangelicals:17,environmentalists:11,libertarians:7,progressives:11,patriots:11,gunowners:14}},
  GA:{race:{white:52,black:33,hispanic:10,asian:4,other:1},educ:{no_college:58,college:28,graduate:14},wealth:{low:28,middle:52,high:20},age:{young:26,mid:27,mature:26,senior:21},ideo:{evangelicals:15,environmentalists:8,libertarians:5,progressives:14,patriots:8,gunowners:11}},
  KY:{race:{white:84,black:8,hispanic:4,asian:2,other:2},educ:{no_college:64,college:26,graduate:10},wealth:{low:32,middle:52,high:16},age:{young:24,mid:25,mature:27,senior:24},ideo:{evangelicals:24,environmentalists:4,libertarians:6,progressives:7,patriots:12,gunowners:16}},
  LA:{race:{white:58,black:33,hispanic:6,asian:2,other:1},educ:{no_college:64,college:26,graduate:10},wealth:{low:34,middle:50,high:16},age:{young:26,mid:26,mature:26,senior:22},ideo:{evangelicals:26,environmentalists:4,libertarians:5,progressives:8,patriots:10,gunowners:14}},
  MS:{race:{white:56,black:38,hispanic:3,asian:1,other:2},educ:{no_college:66,college:24,graduate:10},wealth:{low:38,middle:48,high:14},age:{young:26,mid:25,mature:26,senior:23},ideo:{evangelicals:30,environmentalists:3,libertarians:4,progressives:7,patriots:11,gunowners:14}},
  NC:{race:{white:62,black:22,hispanic:10,asian:3,other:3},educ:{no_college:58,college:28,graduate:14},wealth:{low:28,middle:52,high:20},age:{young:24,mid:26,mature:27,senior:23},ideo:{evangelicals:15,environmentalists:8,libertarians:6,progressives:12,patriots:10,gunowners:12}},
  SC:{race:{white:63,black:27,hispanic:6,asian:2,other:2},educ:{no_college:60,college:28,graduate:12},wealth:{low:30,middle:52,high:18},age:{young:24,mid:25,mature:27,senior:24},ideo:{evangelicals:22,environmentalists:4,libertarians:6,progressives:8,patriots:11,gunowners:14}},
  TN:{race:{white:73,black:17,hispanic:6,asian:2,other:2},educ:{no_college:60,college:28,graduate:12},wealth:{low:30,middle:52,high:18},age:{young:24,mid:26,mature:27,senior:23},ideo:{evangelicals:24,environmentalists:4,libertarians:6,progressives:7,patriots:11,gunowners:15}},
  VA:{race:{white:61,black:20,hispanic:10,asian:7,other:2},educ:{no_college:50,college:30,graduate:20},wealth:{low:22,middle:52,high:26},age:{young:24,mid:27,mature:27,senior:22},ideo:{evangelicals:10,environmentalists:19,libertarians:6,progressives:26,patriots:6,gunowners:9}},
  WV:{race:{white:92,black:4,hispanic:2,asian:1,other:1},educ:{no_college:68,college:22,graduate:10},wealth:{low:36,middle:50,high:14},age:{young:22,mid:23,mature:28,senior:27},ideo:{evangelicals:22,environmentalists:4,libertarians:6,progressives:5,patriots:14,gunowners:18}},
  IA:{race:{white:85,black:4,hispanic:6,asian:3,other:2},educ:{no_college:58,college:30,graduate:12},wealth:{low:24,middle:56,high:20},age:{young:24,mid:24,mature:26,senior:26},ideo:{evangelicals:16,environmentalists:9,libertarians:7,progressives:8,patriots:11,gunowners:15}},
  IL:{race:{white:61,black:15,hispanic:18,asian:6,other:0},educ:{no_college:54,college:30,graduate:16},wealth:{low:26,middle:52,high:22},age:{young:24,mid:26,mature:26,senior:24},ideo:{evangelicals:7,environmentalists:16,libertarians:5,progressives:23,patriots:4,gunowners:5}},
  IN:{race:{white:79,black:10,hispanic:7,asian:3,other:1},educ:{no_college:62,college:26,graduate:12},wealth:{low:28,middle:54,high:18},age:{young:24,mid:26,mature:26,senior:24},ideo:{evangelicals:18,environmentalists:5,libertarians:7,progressives:8,patriots:10,gunowners:14}},
  KS:{race:{white:75,black:6,hispanic:12,asian:3,other:4},educ:{no_college:56,college:30,graduate:14},wealth:{low:26,middle:54,high:20},age:{young:26,mid:26,mature:25,senior:23},ideo:{evangelicals:20,environmentalists:5,libertarians:8,progressives:7,patriots:11,gunowners:14}},
  MI:{race:{white:74,black:14,hispanic:5,asian:3,other:4},educ:{no_college:58,college:28,graduate:14},wealth:{low:28,middle:52,high:20},age:{young:23,mid:25,mature:27,senior:25},ideo:{evangelicals:12,environmentalists:10,libertarians:6,progressives:13,patriots:7,gunowners:12}},
  MN:{race:{white:79,black:7,hispanic:6,asian:5,other:3},educ:{no_college:52,college:32,graduate:16},wealth:{low:22,middle:56,high:22},age:{young:24,mid:27,mature:26,senior:23},ideo:{evangelicals:9,environmentalists:15,libertarians:6,progressives:17,patriots:5,gunowners:10}},
  MO:{race:{white:79,black:12,hispanic:5,asian:2,other:2},educ:{no_college:60,college:28,graduate:12},wealth:{low:28,middle:54,high:18},age:{young:24,mid:25,mature:26,senior:25},ideo:{evangelicals:20,environmentalists:5,libertarians:7,progressives:8,patriots:11,gunowners:14}},
  ND:{race:{white:84,black:3,hispanic:4,asian:2,other:7},educ:{no_college:56,college:32,graduate:12},wealth:{low:22,middle:58,high:20},age:{young:26,mid:26,mature:25,senior:23},ideo:{evangelicals:18,environmentalists:5,libertarians:9,progressives:5,patriots:13,gunowners:16}},
  NE:{race:{white:79,black:5,hispanic:12,asian:3,other:1},educ:{no_college:56,college:30,graduate:14},wealth:{low:24,middle:56,high:20},age:{young:26,mid:26,mature:25,senior:23},ideo:{evangelicals:18,environmentalists:5,libertarians:8,progressives:6,patriots:12,gunowners:14}},
  OH:{race:{white:78,black:13,hispanic:4,asian:2,other:3},educ:{no_college:60,college:28,graduate:12},wealth:{low:28,middle:54,high:18},age:{young:23,mid:25,mature:27,senior:25},ideo:{evangelicals:16,environmentalists:8,libertarians:7,progressives:9,patriots:11,gunowners:15}},
  SD:{race:{white:82,black:2,hispanic:4,asian:2,other:10},educ:{no_college:58,college:30,graduate:12},wealth:{low:26,middle:56,high:18},age:{young:24,mid:25,mature:26,senior:25},ideo:{evangelicals:18,environmentalists:5,libertarians:9,progressives:5,patriots:13,gunowners:16}},
  WI:{race:{white:81,black:7,hispanic:7,asian:3,other:2},educ:{no_college:56,college:30,graduate:14},wealth:{low:24,middle:56,high:20},age:{young:23,mid:25,mature:27,senior:25},ideo:{evangelicals:12,environmentalists:11,libertarians:7,progressives:13,patriots:7,gunowners:11}},
  AZ:{race:{white:54,black:5,hispanic:32,asian:4,other:5},educ:{no_college:58,college:28,graduate:14},wealth:{low:28,middle:52,high:20},age:{young:24,mid:26,mature:26,senior:24},ideo:{evangelicals:11,environmentalists:10,libertarians:9,progressives:12,patriots:8,gunowners:10}},
  NM:{race:{white:37,black:2,hispanic:49,asian:2,other:10},educ:{no_college:58,college:28,graduate:14},wealth:{low:32,middle:50,high:18},age:{young:24,mid:25,mature:27,senior:24},ideo:{evangelicals:10,environmentalists:18,libertarians:6,progressives:22,patriots:5,gunowners:6}},
  OK:{race:{white:65,black:8,hispanic:11,asian:2,other:14},educ:{no_college:62,college:26,graduate:12},wealth:{low:30,middle:52,high:18},age:{young:26,mid:26,mature:25,senior:23},ideo:{evangelicals:26,environmentalists:4,libertarians:7,progressives:6,patriots:12,gunowners:16}},
  TX:{race:{white:41,black:13,hispanic:40,asian:5,other:1},educ:{no_college:60,college:28,graduate:12},wealth:{low:28,middle:52,high:20},age:{young:27,mid:27,mature:25,senior:21},ideo:{evangelicals:19,environmentalists:6,libertarians:9,progressives:10,patriots:10,gunowners:13}},
  AK:{race:{white:60,black:4,hispanic:7,asian:6,other:23},educ:{no_college:56,college:30,graduate:14},wealth:{low:22,middle:56,high:22},age:{young:26,mid:28,mature:28,senior:18},ideo:{evangelicals:14,environmentalists:7,libertarians:12,progressives:6,patriots:13,gunowners:17}},
  CA:{race:{white:37,black:6,hispanic:39,asian:15,other:3},educ:{no_college:52,college:32,graduate:16},wealth:{low:28,middle:50,high:22},age:{young:26,mid:27,mature:25,senior:22},ideo:{evangelicals:8,environmentalists:19,libertarians:5,progressives:22,patriots:4,gunowners:6}},
  CO:{race:{white:68,black:4,hispanic:22,asian:4,other:2},educ:{no_college:50,college:32,graduate:18},wealth:{low:22,middle:54,high:24},age:{young:26,mid:28,mature:26,senior:20},ideo:{evangelicals:9,environmentalists:21,libertarians:9,progressives:20,patriots:8,gunowners:7}},
  HI:{race:{white:22,black:2,hispanic:11,asian:37,other:28},educ:{no_college:54,college:30,graduate:16},wealth:{low:22,middle:54,high:24},age:{young:24,mid:26,mature:26,senior:24},ideo:{evangelicals:7,environmentalists:18,libertarians:4,progressives:20,patriots:4,gunowners:5}},
  ID:{race:{white:82,black:1,hispanic:13,asian:2,other:2},educ:{no_college:60,college:28,graduate:12},wealth:{low:26,middle:56,high:18},age:{young:26,mid:26,mature:25,senior:23},ideo:{evangelicals:16,environmentalists:6,libertarians:12,progressives:5,patriots:13,gunowners:18}},
  MT:{race:{white:86,black:1,hispanic:4,asian:1,other:8},educ:{no_college:56,college:30,graduate:14},wealth:{low:26,middle:56,high:18},age:{young:22,mid:24,mature:28,senior:26},ideo:{evangelicals:14,environmentalists:8,libertarians:12,progressives:6,patriots:12,gunowners:18}},
  NV:{race:{white:48,black:10,hispanic:29,asian:9,other:4},educ:{no_college:60,college:28,graduate:12},wealth:{low:28,middle:52,high:20},age:{young:24,mid:27,mature:27,senior:22},ideo:{evangelicals:10,environmentalists:8,libertarians:10,progressives:10,patriots:8,gunowners:11}},
  OR:{race:{white:75,black:2,hispanic:13,asian:5,other:5},educ:{no_college:54,college:30,graduate:16},wealth:{low:26,middle:54,high:20},age:{young:24,mid:26,mature:27,senior:23},ideo:{evangelicals:6,environmentalists:20,libertarians:8,progressives:22,patriots:4,gunowners:6}},
  UT:{race:{white:78,black:1,hispanic:14,asian:3,other:4},educ:{no_college:54,college:32,graduate:14},wealth:{low:20,middle:58,high:22},age:{young:30,mid:28,mature:23,senior:19},ideo:{evangelicals:30,environmentalists:5,libertarians:8,progressives:5,patriots:10,gunowners:10}},
  WA:{race:{white:68,black:4,hispanic:13,asian:10,other:5},educ:{no_college:50,college:32,graduate:18},wealth:{low:22,middle:54,high:24},age:{young:24,mid:28,mature:26,senior:22},ideo:{evangelicals:7,environmentalists:20,libertarians:7,progressives:22,patriots:4,gunowners:7}},
  WY:{race:{white:84,black:1,hispanic:10,asian:1,other:4},educ:{no_college:60,college:28,graduate:12},wealth:{low:24,middle:58,high:18},age:{young:24,mid:26,mature:27,senior:23},ideo:{evangelicals:16,environmentalists:5,libertarians:13,progressives:4,patriots:14,gunowners:20}},
  DC:{race:{white:38,black:46,hispanic:11,asian:4,other:1},educ:{no_college:38,college:32,graduate:30},wealth:{low:30,middle:40,high:30},age:{young:28,mid:30,mature:24,senior:18},ideo:{evangelicals:6,environmentalists:16,libertarians:3,progressives:28,patriots:3,gunowners:4}},
};

const F91 = {race:{white:1.33,black:1,hispanic:.47,asian:.5,other:.33},educ:{no_college:1.15,college:.7,graduate:.55},wealth:{low:1.1,middle:1,high:.85},age:{young:1.15,mid:1.05,mature:.95,senior:.85},ideo:{evangelicals:1.15,environmentalists:.7,libertarians:.95,progressives:.7,patriots:1.15,gunowners:1.1}};

function shift(shares, factors) {
  var keys = Object.keys(shares);
  var sc = keys.map(function(k) { return shares[k] * (factors[k] || 1); });
  var t = sc.reduce(function(s,v){return s+v;},0) || 1;
  var f = sc.map(function(v){return (v/t)*100;});
  var is = f.map(function(v){return Math.floor(v);});
  var r = f.map(function(v,i){return{v:v-i, i:i};}).sort(function(a,b){return b.v-a.v;});
  var d = 100 - is.reduce(function(s,v){return s+v;},0);
  for (var i=0;i<d;i++) is[r[i].i]++;
  var o = {};
  keys.forEach(function(k,i){o[k]=is[i];});
  return o;
}

var raw1991 = {};
for (var s in raw2019) {
  var d=raw2019[s];
  raw1991[s]={race:shift(d.race,F91.race),educ:shift(d.educ,F91.educ),wealth:shift(d.wealth,F91.wealth),age:shift(d.age,F91.age),ideo:shift(d.ideo,F91.ideo)};
}

function buildPage() {
  var html = fs.readFileSync(path.join(__dirname, "election-map.html"), "utf8");
  // Inject embedded JSON data
  html = html.replace("/*__CENSUS2019__*/", JSON.stringify(raw2019));
  html = html.replace("/*__CENSUS1991__*/", JSON.stringify(raw1991));
  html = html.replace("/*__EV__*/", JSON.stringify({AL:9,AK:3,AZ:11,AR:6,CA:54,CO:10,CT:7,DE:3,DC:3,FL:30,GA:16,HI:4,ID:4,IL:19,IN:11,IA:6,KS:6,KY:8,LA:8,ME:4,MD:10,MA:11,MI:15,MN:10,MS:6,MO:10,MT:4,NE:5,NV:6,NH:4,NJ:14,NM:5,NY:28,NC:16,ND:3,OH:17,OK:7,OR:8,PA:19,RI:4,SC:9,SD:3,TN:11,TX:40,UT:6,VT:3,VA:13,WA:12,WV:4,WI:10,WY:3}));
  html = html.replace("/*__SVG__*/", JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname,"election-map-svg.json"),"utf8"))));
  return html;
}

module.exports = { makeElectionMapPage: buildPage };