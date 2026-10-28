// Server-safe constants: inline scripts that run in <head> before first paint (no flash of the wrong theme or language).
// Kept out of the 'use client' modules so server layouts can use them as plain strings.
export const THEME_KEY = 'dw.theme';
export const LANG_KEY = 'dw.lang';

export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','light')}`;

export const LANG_BOOT_SCRIPT = `try{if(localStorage.getItem('${LANG_KEY}')==='en'){var h=document.documentElement;h.lang='en';h.setAttribute('data-lang-pending','');setTimeout(function(){h.removeAttribute('data-lang-pending')},2500)}}catch(e){}`;
