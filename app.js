document.getElementById("calcForm").addEventListener("submit", function(e) {
  e.preventDefault();
  const type = document.getElementById("typeSelect").value;
  const d4 = document.getElementById("inputD4").value;
  const g4 = document.getElementById("inputG4").value;
  const i4 = document.getElementById("inputI4").value;
  const d7 = parseFloat(document.getElementById("inputD7").value);
  const i7 = parseFloat(document.getElementById("inputI7").value);

  const code = d4 + g4[0] + i4[0];
  document.getElementById("codeOut").textContent = code;

const data = {
PCR: { "757-200RA": {maxTaxi:116119, minWt:51709, acrMax:310, acrMin:110}, 
	"757-200RB": {maxTaxi:116119, minWt:51709, acrMax:370, acrMin:120},
	"757-200RC": {maxTaxi:116119, minWt:51709, acrMax:420, acrMin:130},
	"757-200RD": {maxTaxi:116119, minWt:51709, acrMax:470, acrMin:150},
	"757-200FA": {maxTaxi:116119, minWt:51709, acrMax:260, acrMin:120},
	"757-200FB": {maxTaxi:116119, minWt:51709, acrMax:290, acrMin:120},
	"757-200FC": {maxTaxi:116119, minWt:51709, acrMax:340, acrMin:120},
	"757-200FD": {maxTaxi:116119, minWt:51709, acrMax:450, acrMin:130},
	"767-300ERRA": {maxTaxi:187333, minWt:90010, acrMax:530, acrMin:200},
	"767-300ERRB": {maxTaxi:187333, minWt:90010, acrMax:620, acrMin:220},
	"767-300ERRC": {maxTaxi:187333, minWt:90010, acrMax:700, acrMin:250},
	"767-300ERRD": {maxTaxi:187333, minWt:90010, acrMax:780, acrMin:280},
	"767-300ERFA": {maxTaxi:187333, minWt:90010, acrMax:440, acrMin:210},
	"767-300ERFB": {maxTaxi:187333, minWt:90010, acrMax:480, acrMin:210},
	"767-300ERFC": {maxTaxi:187333, minWt:90010, acrMax:560, acrMin:220},
	"767-300ERFD": {maxTaxi:187333, minWt:90010, acrMax:740, acrMin:240},
	"777FRA": {maxTaxi:348721, minWt:144378, acrMax:760, acrMin:220},
	"777FRB": {maxTaxi:348721, minWt:144378, acrMax:970, acrMin:240},
	"777FRC": {maxTaxi:348721, minWt:144378, acrMax:1140, acrMin:270},
	"777FRD": {maxTaxi:348721, minWt:144378, acrMax:1320, acrMin:320},
	"777FFA": {maxTaxi:348721, minWt:144378, acrMax:560, acrMin:230},
	"777FFB": {maxTaxi:348721, minWt:144378, acrMax:610, acrMin:230},
	"777FFC": {maxTaxi:348721, minWt:144378, acrMax:760, acrMin:240},
	"777FFD": {maxTaxi:348721, minWt:144378, acrMax:1180, acrMin:260} },
PCN: { "757-200RA": {maxTaxi:116119, minWt:51709, acrMax:31, acrMin:11},
	"757-200RB": {maxTaxi:116119, minWt:51709, acrMax:37, acrMin:12},
	"757-200RC": {maxTaxi:116119, minWt:51709, acrMax:43, acrMin:14},
	"757-200RD": {maxTaxi:116119, minWt:51709, acrMax:49, acrMin:17},
	"757-200FA": {maxTaxi:116119, minWt:51709, acrMax:30, acrMin:11},
	"757-200FB": {maxTaxi:116119, minWt:51709, acrMax:33, acrMin:12},
	"757-200FC": {maxTaxi:116119, minWt:51709, acrMax:40, acrMin:13},
	"757-200FD": {maxTaxi:116119, minWt:51709, acrMax:53, acrMin:16},
	"767-300ERRA": {maxTaxi:187333, minWt:90010, acrMax:48, acrMin:19},
	"767-300ERRB": {maxTaxi:187333, minWt:90010, acrMax:57, acrMin:22},
	"767-300ERRC": {maxTaxi:187333, minWt:90010, acrMax:68, acrMin:25},
	"767-300ERRD": {maxTaxi:187333, minWt:90010, acrMax:78, acrMin:29},
	"767-300ERFA": {maxTaxi:187333, minWt:90010, acrMax:49, acrMin:20},
	"767-300ERFB": {maxTaxi:187333, minWt:90010, acrMax:54, acrMin:21},
	"767-300ERFC": {maxTaxi:187333, minWt:90010, acrMax:66, acrMin:23},
	"767-300ERFD": {maxTaxi:187333, minWt:90010, acrMax:87, acrMin:30},
	"777FRA": {maxTaxi:348721, minWt:144378, acrMax:64, acrMin:21},
	"777FRB": {maxTaxi:348721, minWt:144378, acrMax:83, acrMin:23},
	"777FRC": {maxTaxi:348721, minWt:144378, acrMax:106, acrMin:27},
	"777FRD": {maxTaxi:348721, minWt:144378, acrMax:128, acrMin:34},
	"777FFA": {maxTaxi:348721, minWt:144378, acrMax:62, acrMin:19},
	"777FFB": {maxTaxi:348721, minWt:144378, acrMax:69, acrMin:21},
	"777FFC": {maxTaxi:348721, minWt:144378, acrMax:86, acrMin:23},
	"777FFD": {maxTaxi:348721, minWt:144378, acrMax:117, acrMin:31} }
};

  const config = data[type][code];
  if (!config) {
    alert("Configuration not found!");
    return;
  }

  const d8 = config.acrMax - ((config.maxTaxi - d7) / (config.maxTaxi - config.minWt)) * (config.acrMax - config.acrMin);
  const i8 = ((i7 - config.acrMax) / (config.acrMax - config.acrMin)) * (config.maxTaxi - config.minWt) + config.maxTaxi;

  document.getElementById("resultD8").textContent = d8.toFixed(2);
  document.getElementById("resultI8").textContent = i8.toFixed(2);
});
