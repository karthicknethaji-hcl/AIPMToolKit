// ── Header org name renderer ──
// Reads companyProfile.companyName via getOrgName() and updates the header logo slot.
// Shows the org name + separator when set; hides both when empty.
// Called on DOMContentLoaded and after settingsPageSave().
function updateHeaderOrg(){
  const logoEl=document.getElementById('logo-txt');
  const sepEl=document.getElementById('hdr-sep');
  const orgName=typeof getOrgName==='function'?getOrgName():'';
  if(logoEl){logoEl.textContent=orgName;}
  if(sepEl){sepEl.style.display=orgName?'':'none';}
  if(logoEl){logoEl.style.display=orgName?'':'none';}
}

// ── Avatar initials helper ──
// Returns up to two initials: first char of first name + first char of last name.
// Single word → one initial. Empty → '?'.
function _avatarInitials(displayName){
  const parts=(displayName||'').trim().split(/\s+/).filter(Boolean);
  if(parts.length===0)return'?';
  if(parts.length===1)return parts[0][0].toUpperCase();
  return(parts[0][0]+parts[parts.length-1][0]).toUpperCase();
}

// ── Avatar badge — populate from currentUser ──
function updateHeaderAvatar(){
  if(!currentUser)return;
  const badge=document.getElementById('hdr-avatar');
  const nameEl=document.getElementById('hdr-avatar-name');
  const emailEl=document.getElementById('hdr-avatar-email');
  if(badge)badge.textContent=_avatarInitials(currentUser.displayName);
  if(nameEl)nameEl.textContent=currentUser.displayName||'';
  if(emailEl)emailEl.textContent=currentUser.email||'';
}

// ── Avatar dropdown toggle ──
function hdrAvatarToggle(){
  const drop=document.getElementById('hdr-avatar-drop');
  const overlay=document.getElementById('hdr-avatar-overlay');
  if(!drop)return;
  const isOpen=drop.classList.contains('open');
  if(isOpen){
    drop.classList.remove('open');
    overlay.classList.remove('open');
  } else {
    drop.classList.add('open');
    overlay.classList.add('open');
  }
}

// ── Close dropdown ──
function hdrAvatarClose(){
  const drop=document.getElementById('hdr-avatar-drop');
  const overlay=document.getElementById('hdr-avatar-overlay');
  if(drop)drop.classList.remove('open');
  if(overlay)overlay.classList.remove('open');
}

// ── Open My Profile in Settings ──
function hdrOpenProfile(){
  hdrAvatarClose();
  if(typeof openSettingsToSection==='function') openSettingsToSection(0);
}

// ── Sign out ──
function hdrSignOut(){
  hdrAvatarClose();
  if(typeof authSignOut==='function')authSignOut();
}

// ── Global current user ──
// Populated after auth gate passes. Available to all modules.
// { id, email, displayName }
var currentUser = null;

document.addEventListener('DOMContentLoaded', async function(){
  // ── Version string — set from APP_VERSION in config.js ──
  var _vEl=document.getElementById('hdr-version');
  if(_vEl&&typeof APP_VERSION!=='undefined')_vEl.textContent=APP_VERSION;

  // ── Auth gate (Step 2) ──
  // Check for a valid Supabase session before the app initialises.
  // No session → redirect to login.html immediately.
  // Valid session → populate currentUser and continue.
  var session = await authGetSession();
  if (!session) {
    window.location.href = 'login.html';
    return; // stop execution — page is redirecting
  }
  // Populate currentUser for all downstream modules
  currentUser = await authGetUser();

  // ── Avatar badge (Step 3) ──
  updateHeaderAvatar();

  // ── App initialisation (Steps 6 + 7) ──
  // Run both syncs in parallel — sessions and profiles are independent queries.
  // Both must complete before homeInit() so the product selector and session list
  // are populated from fresh DB data on first render.
  await Promise.all([
    (typeof sessionStoreSyncFromDB === 'function') ? sessionStoreSyncFromDB() : Promise.resolve(),
    (typeof spSyncProfilesFromDB   === 'function') ? spSyncProfilesFromDB()   : Promise.resolve()
  ]);

  // Render org name after profile sync — companyProfile now has fresh DB data
  updateHeaderOrg();

  // Initialise Home tab — replaces loading stub with session library or empty state
  if(typeof homeInit==='function')homeInit();
  // Initialise new seg controls (industry dropdown, user type, operating context)
  // and additional context character counter
  if(typeof initSegControls==='function')initSegControls();
  // Apply feature toggles on load so MI-gated elements respect default off state
  if(typeof applyFeats==='function')applyFeats();
});
