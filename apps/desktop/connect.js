"use strict";
document.querySelector("form").onsubmit = async event => {
  event.preventDefault(); const result = await window.keir.connect(document.getElementById("server").value);
  if (result.error) document.getElementById("error").textContent = result.error;
};
