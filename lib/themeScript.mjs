// Runs before first paint: apply the saved theme (dark by default) and outdoor
// contrast so the page never flashes the wrong palette. ThemeContext keeps it in sync.
// next.config.mjs allows exactly this text in the CSP by its sha256 hash, so any
// edit here updates the policy on the next build.
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement;var s=localStorage.getItem('theme');if(s!=='light'&&s!=='dark')s=localStorage.getItem('pbafarm:theme-default');var t=s==='light'?'light':'dark';d.dataset.theme=t;d.classList.toggle('dark',t==='dark');d.style.colorScheme=t;if(localStorage.getItem('pbafarm:contrast')==='high')d.dataset.contrast='high';var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='dark'?'#0a0b0c':'#f4f7fb');}catch(e){}})();`
