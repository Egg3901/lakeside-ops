"use strict";

/**
 * Safe DOM helpers for client-injected scripts.
 *
 * Prefer textContent / createElement over innerHTML. When trusted markup from
 * our own templates is unavoidable, use setTrustedHtml and never pass
 * user-controlled strings without escaping first.
 */

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Client-side snippet: define window.OpsDom helpers once. */
const CLIENT_JS = `
(function(w){
  if(w.OpsDom) return;
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function setText(el,text){if(!el)return;el.textContent=text==null?'':String(text);}
  function clear(el){if(!el)return;while(el.firstChild)el.removeChild(el.firstChild);}
  function setTrustedHtml(el,html){
    if(!el)return;
    // Trusted server/template HTML only. Callers must escape user data first.
    el.innerHTML=html==null?'':String(html);
  }
  function el(tag,attrs,children){
    var n=document.createElement(tag);
    if(attrs){Object.keys(attrs).forEach(function(k){
      if(k==='className')n.className=attrs[k];
      else if(k==='text')n.textContent=attrs[k];
      else if(k.slice(0,2)==='on'&&typeof attrs[k]==='function')n.addEventListener(k.slice(2).toLowerCase(),attrs[k]);
      else if(attrs[k]!=null)n.setAttribute(k,attrs[k]);
    });}
    (children||[]).forEach(function(c){if(c==null)return;n.appendChild(typeof c==='string'?document.createTextNode(c):c);});
    return n;
  }
  w.OpsDom={esc:esc,escapeHtml:esc,setText:setText,clear:clear,setTrustedHtml:setTrustedHtml,el:el};
})(window);
`.trim();

function clientBootstrapScript() {
  return `<script>${CLIENT_JS}</script>`;
}

module.exports = {
  escapeHtml,
  CLIENT_JS,
  clientBootstrapScript,
};
