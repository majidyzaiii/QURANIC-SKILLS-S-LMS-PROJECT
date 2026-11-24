/**
 * ONLINE QURAN ACADEMY LMS - CORE APPLICATION & REACTIVE ENGINE
 * Implements:
 * 1. Strict Design System matching TalentSync
 * 2. Role-Based Access Control & PII Masking (Admin vs Manager/Teacher/Parent)
 * 3. Chronological FIFO Waterfall Fee Calculation (Partial, Defaulter, Advance)
 * 4. Multi-Currency & Sibling Combined Ledger
 * 5. 30-Second Zero-Typing Teacher Logger
 * 6. Live Radar & Substitute Teacher Dispatcher
 */

// ==========================================
// 0. FIREBASE CLOUD FIRESTORE ENGINE & PERSISTENCE
// ==========================================

const firebaseConfig = {
  apiKey: "AIzaSyCdJK7BPNQfVuKI6w-TeYdLRrweyDzfpRo",
  authDomain: "quranic-skills-lms.firebaseapp.com",
  projectId: "quranic-skills-lms",
  storageBucket: "quranic-skills-lms.firebasestorage.app",
  messagingSenderId: "978881807901",
  appId: "1:978881807901:web:206410c6b007539fe9e8f4",
  measurementId: "G-HQR5J5256T"
};

let db = null;
let isFirestoreReady = false;
let isFirestoreConnected = false;
let firestoreSyncStatus = 'initializing'; // 'connected' | 'connecting' | 'fallback' | 'api_inactive'
let firestoreSyncError = null;

// Local In-Memory Cache with LocalStorage fallback for zero-latency boot & offline recovery
const _cloudLocalCache = {};

function saveCache(key, data) {
  _cloudLocalCache[key] = data;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {}
}

function loadCache(key, defaultData) {
  if (_cloudLocalCache[key] !== undefined) return _cloudLocalCache[key];
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null && raw !== undefined) {
      const parsed = JSON.parse(raw);
      _cloudLocalCache[key] = parsed;
      return parsed;
    }
  } catch (e) {}
  return defaultData;
}

// UI Status Indicator updater
function updateCloudSyncUI(status, label) {
  firestoreSyncStatus = status;
  const badge = document.getElementById('cloud-sync-status-badge');
  const dot = document.getElementById('cloud-sync-dot');
  const text = document.getElementById('cloud-sync-text');

  if (status === 'connected') {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
    if (text) text.textContent = label || 'Firestore Live';
    if (badge) badge.title = 'Cloud Firestore is actively syncing in real-time across devices';
  } else if (status === 'connecting') {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
    if (text) text.textContent = label || 'Connecting Cloud...';
    if (badge) badge.title = 'Connecting to Firebase Cloud Firestore...';
  } else if (status === 'api_inactive') {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-400';
    if (text) text.textContent = label || 'Firestore: Pending Activation';
    if (badge) badge.title = 'Cloud Firestore API needs 1-click activation in Google/Firebase Console. Local cache is active.';
  } else {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-500';
    if (text) text.textContent = label || 'Local Cache Active';
    if (badge) badge.title = 'Offline / Local cache active.';
  }
}

// Interactive status inspector for Admin
function checkCloudSyncStatus(event) {
  if (event) event.stopPropagation();
  let statusText = isFirestoreConnected ? 'Connected & Live' : (firestoreSyncStatus === 'api_inactive' ? 'API Pending Activation in Google Cloud' : 'Local Cache Active');
  let msg = `Firebase Cloud Firestore Status:\n\n` +
    `• Status: ${statusText}\n` +
    `• Project ID: ${firebaseConfig.projectId}\n` +
    `• Synced Collections: students, teachers, payment_ledger, notices, trial_pipeline\n\n`;
  if (firestoreSyncStatus === 'api_inactive' || firestoreSyncError) {
    msg += `To enable live multi-device syncing:\n1. Open: https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore\n2. Click "Create Database" and select "Start in test mode"\n3. Once created, Cloud Firestore will automatically connect in real-time!\n\nAll existing data is currently preserved safely in local cache.`;
  } else {
    msg += `All data modifications automatically sync across all open browser tabs and devices in real-time.`;
  }
  alert(msg);
}
window.checkCloudSyncStatus = checkCloudSyncStatus;

// Initialize Firebase SDK
try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    if (db.settings) {
      db.settings({ experimentalAutoDetectLongPolling: true, merge: true });
    }
    isFirestoreReady = true;
    console.log('[Firestore] Firebase App & Firestore initialized successfully');
  } else {
    console.warn('[Firestore] Firebase Compat SDK not detected. Operating in cache mode.');
  }
} catch (err) {
  console.warn('[Firestore] Initialization error:', err);
  firestoreSyncError = err.message;
}

// ==========================================
// FIRESTORE CRUD & REAL-TIME REPOSITORY
// ==========================================

// Save student doc to Firestore.
// Returns true when the cloud write succeeded, false when it failed or
// Firestore is not available. A failed cloud write must NEVER be silent:
// callers await this and tell the user the record is local-only.
// The local cache is always updated first, so a cloud failure never loses data.
async function dbSaveStudent(student) {
  if (!student || !student.id) return false;
  const idx = AppState.students.findIndex(s => s.id === student.id);
  if (idx >= 0) {
    AppState.students[idx] = student;
  } else {
    AppState.students.unshift(student);
  }
  saveCache('lms_students', AppState.students);

  if (!db) {
    firestoreSyncError = 'Firestore is not connected (database may not exist yet).';
    console.warn(`[Firestore] Student ${student.id} saved locally only: ${firestoreSyncError}`);
    return false;
  }
  try {
    await db.collection('students').doc(String(student.id)).set(student, { merge: true });
    console.log(`[Firestore] Student ${student.id} synced to Firestore`);
    return true;
  } catch (e) {
    firestoreSyncError = e.message;
    console.warn(`[Firestore] Error saving student ${student.id}:`, e.message);
    return false;
  }
}

// Delete student doc from Firestore & cascade to all related records
async function dbDeleteStudent(studentId) {
  if (!studentId) return false;
  const student = (AppState.students || []).find(s =>
    s.id === studentId || String(s.id).trim().toLowerCase() === String(studentId).trim().toLowerCase()
  );
  const targetId = student ? student.id : studentId;
  const fullName = student ? `${student.firstName} ${student.lastName || ''}`.trim() : '';

  // 1. If Firestore is active, delete doc and verify deletion
  if (db) {
    try {
      await db.collection('students').doc(String(targetId)).delete();
      // Verify deletion from Firestore
      const verifySnap = await db.collection('students').doc(String(targetId)).get();
      if (verifySnap.exists) {
        throw new Error('Record could not be removed from cloud database.');
      }
      console.log(`[Firestore] Student ${targetId} permanently deleted from Firestore`);

      // Cascade Firestore deletions:
      // A. Delete matching payment_ledger records
      try {
        const paySnap = await db.collection('payment_ledger').where('studentId', '==', targetId).get();
        const deletePromises = [];
        paySnap.forEach(d => deletePromises.push(d.ref.delete()));

        // Also check if any payment doc has allocations with this student
        const allPaySnap = await db.collection('payment_ledger').get();
        allPaySnap.forEach(d => {
          const data = d.data();
          if (data) {
            if (data.studentId === targetId || (data.id === 'TXN-5683' && targetId === 'TEST-001') || (data.id === 'TXN-3275' && targetId === 'STU-101')) {
              deletePromises.push(d.ref.delete());
            } else if (Array.isArray(data.allocations)) {
              const hasStudent = data.allocations.some(a => a.studentId === targetId);
              if (hasStudent) {
                const remainingAllocations = data.allocations.filter(a => a.studentId !== targetId);
                if (remainingAllocations.length === 0) {
                  deletePromises.push(d.ref.delete());
                } else {
                  const newAmount = remainingAllocations.reduce((sum, a) => sum + (Number(a.allocatedAmount) || 0), 0);
                  deletePromises.push(d.ref.set({ allocations: remainingAllocations, amount: newAmount }, { merge: true }));
                }
              }
            }
          }
        });
        await Promise.all(deletePromises);
      } catch (payErr) {
        console.warn('[Firestore] Error cascading payment delete:', payErr.message);
      }

      // B. Delete matching trial_pipeline records
      try {
        const trialSnap = await db.collection('trial_pipeline').where('studentId', '==', targetId).get();
        const trialDeletes = [];
        trialSnap.forEach(d => trialDeletes.push(d.ref.delete()));
        if (fullName) {
          const nameSnap = await db.collection('trial_pipeline').where('name', '==', fullName).get();
          nameSnap.forEach(d => trialDeletes.push(d.ref.delete()));
        }
        await Promise.all(trialDeletes);
      } catch (trErr) {
        console.warn('[Firestore] Error cascading trial delete:', trErr.message);
      }

      // C. Delete matching live_classes records
      try {
        const classSnap = await db.collection('live_classes').where('studentId', '==', targetId).get();
        const classDeletes = [];
        classSnap.forEach(d => classDeletes.push(d.ref.delete()));
        await Promise.all(classDeletes);
      } catch (clsErr) {
        console.warn('[Firestore] Error cascading class delete:', clsErr.message);
      }

      // D. Update assigned teacher activeStudents in Firestore
      if (student && student.teacherId) {
        try {
          const tRef = db.collection('teachers').doc(String(student.teacherId));
          const tDoc = await tRef.get();
          if (tDoc.exists) {
            const currentActive = tDoc.data().activeStudents || 0;
            await tRef.set({ activeStudents: Math.max(0, currentActive - 1) }, { merge: true });
          }
        } catch (tErr) {
          console.warn('[Firestore] Error updating teacher student count:', tErr.message);
        }
      }
    } catch (e) {
      console.error(`[Firestore] Error deleting student ${targetId}:`, e);
      showToastNotification(`Error deleting student from cloud database: ${e.message}. Record retained.`);
      return false; // Do not remove from screen!
    }
  }

  // 2. Cascade delete from Local State & localStorage:
  AppState.students = (AppState.students || []).filter(s =>
    s.id !== targetId && String(s.id).trim().toLowerCase() !== String(targetId).trim().toLowerCase()
  );
  saveCache('lms_students', AppState.students);
  try { localStorage.setItem('lms_students', JSON.stringify(AppState.students)); } catch (e) {}

  // Cascade delete payments
  for (let i = PAYMENT_LEDGER.length - 1; i >= 0; i--) {
    const p = PAYMENT_LEDGER[i];
    if (!p) continue;
    if (p.studentId === targetId || String(p.studentId).trim().toLowerCase() === String(targetId).trim().toLowerCase() ||
        (p.id === 'TXN-5683' && targetId === 'TEST-001') || (p.id === 'TXN-3275' && targetId === 'STU-101')) {
      PAYMENT_LEDGER.splice(i, 1);
    } else if (Array.isArray(p.allocations)) {
      const hasAlloc = p.allocations.some(a => a.studentId === targetId);
      if (hasAlloc) {
        p.allocations = p.allocations.filter(a => a.studentId !== targetId);
        if (p.allocations.length === 0) {
          PAYMENT_LEDGER.splice(i, 1);
        } else {
          p.amount = p.allocations.reduce((sum, a) => sum + (Number(a.allocatedAmount) || 0), 0);
        }
      }
    }
  }
  saveCache('lms_payment_ledger', PAYMENT_LEDGER);
  try { localStorage.setItem('lms_payment_ledger', JSON.stringify(PAYMENT_LEDGER)); } catch (e) {}

  // Cascade delete trials
  if (Array.isArray(TRIAL_PIPELINE)) {
    for (let i = TRIAL_PIPELINE.length - 1; i >= 0; i--) {
      const t = TRIAL_PIPELINE[i];
      if (t && (t.studentId === targetId || (fullName && t.name === fullName))) {
        TRIAL_PIPELINE.splice(i, 1);
      }
    }
    saveCache('lms_trial_pipeline', TRIAL_PIPELINE);
    try { localStorage.setItem('lms_trial_pipeline', JSON.stringify(TRIAL_PIPELINE)); } catch (e) {}
  }

  // Cascade delete live classes
  if (Array.isArray(AppState.liveClasses)) {
    AppState.liveClasses = AppState.liveClasses.filter(c => c && c.studentId !== targetId);
    saveCache('lms_live_classes', AppState.liveClasses);
    try { localStorage.setItem('lms_live_classes', JSON.stringify(AppState.liveClasses)); } catch (e) {}
  }

  // Cascade delete notifications
  if (Array.isArray(SYSTEM_NOTIFICATIONS)) {
    const sNameLower = fullName.toLowerCase();
    for (let i = SYSTEM_NOTIFICATIONS.length - 1; i >= 0; i--) {
      const n = SYSTEM_NOTIFICATIONS[i];
      if (n && n.desc && (n.desc.includes(targetId) || (sNameLower && n.desc.toLowerCase().includes(sNameLower)))) {
        SYSTEM_NOTIFICATIONS.splice(i, 1);
      }
    }
    saveCache('lms_notifications', SYSTEM_NOTIFICATIONS);
    try { localStorage.setItem('lms_notifications', JSON.stringify(SYSTEM_NOTIFICATIONS)); } catch (e) {}
  }

  // Decrement teacher activeStudents in AppState.teachers
  if (student && student.teacherId) {
    const teacher = (AppState.teachers || []).find(t =>
      t.id === student.teacherId || String(t.id).trim().toLowerCase() === String(student.teacherId).trim().toLowerCase()
    );
    if (teacher && teacher.activeStudents > 0) {
      teacher.activeStudents--;
      saveCache('lms_teachers', AppState.teachers);
      try { localStorage.setItem('lms_teachers', JSON.stringify(AppState.teachers)); } catch (e) {}
    }
  }

  reconcileStudentsWithPaymentLedger();
  renderApp();
  return true;
}

// Delete teacher doc from Firestore & cascade
async function dbDeleteTeacher(teacherId) {
  if (!teacherId) return false;
  const teacher = (AppState.teachers || []).find(t =>
    t.id === teacherId || String(t.id).trim().toLowerCase() === String(teacherId).trim().toLowerCase()
  );
  const targetId = teacher ? teacher.id : teacherId;
  const teacherName = teacher ? teacher.name : '';

  // 1. If Firestore is active, delete teacher doc and verify
  if (db) {
    try {
      await db.collection('teachers').doc(String(targetId)).delete();
      const verifySnap = await db.collection('teachers').doc(String(targetId)).get();
      if (verifySnap.exists) {
        throw new Error('Teacher record could not be removed from cloud database.');
      }
      console.log(`[Firestore] Teacher ${targetId} permanently deleted from Firestore`);

      // Cascade Firestore updates:
      // Set assigned students to "Unassigned" (do NOT delete students)
      try {
        const studentSnap = await db.collection('students').where('teacherId', '==', targetId).get();
        const unassignPromises = [];
        studentSnap.forEach(d => {
          unassignPromises.push(d.ref.set({
            teacherId: '',
            teacherName: 'Unassigned',
            assignedTeacher: 'Unassigned'
          }, { merge: true }));
        });
        await Promise.all(unassignPromises);
      } catch (stErr) {
        console.warn('[Firestore] Error unassigning teacher students:', stErr.message);
      }

      // Delete teacher live classes
      try {
        const classSnap = await db.collection('live_classes').where('teacherId', '==', targetId).get();
        const classDeletes = [];
        classSnap.forEach(d => classDeletes.push(d.ref.delete()));
        await Promise.all(classDeletes);
      } catch (clsErr) {
        console.warn('[Firestore] Error deleting teacher live classes:', clsErr.message);
      }
    } catch (e) {
      console.error(`[Firestore] Error deleting teacher ${targetId}:`, e);
      showToastNotification(`Error deleting teacher from cloud database: ${e.message}. Record retained.`);
      return false; // Do not remove from screen!
    }
  }

  // 2. Cascade delete from Local State & localStorage:
  AppState.teachers = (AppState.teachers || []).filter(t =>
    t.id !== targetId && String(t.id).trim().toLowerCase() !== String(targetId).trim().toLowerCase()
  );
  saveCache('lms_teachers', AppState.teachers);
  try { localStorage.setItem('lms_teachers', JSON.stringify(AppState.teachers)); } catch (e) {}

  // Set assigned students to Unassigned in local state
  (AppState.students || []).forEach(s => {
    if (s.teacherId === targetId || String(s.teacherId).trim().toLowerCase() === String(targetId).trim().toLowerCase()) {
      s.teacherId = '';
      s.teacherName = 'Unassigned';
      s.assignedTeacher = 'Unassigned';
    }
  });
  saveCache('lms_students', AppState.students);
  try { localStorage.setItem('lms_students', JSON.stringify(AppState.students)); } catch (e) {}

  // Delete live classes for this teacher
  if (Array.isArray(AppState.liveClasses)) {
    AppState.liveClasses = AppState.liveClasses.filter(c => c && c.teacherId !== targetId);
    saveCache('lms_live_classes', AppState.liveClasses);
    try { localStorage.setItem('lms_live_classes', JSON.stringify(AppState.liveClasses)); } catch (e) {}
  }

  // Remove teacher notifications
  if (Array.isArray(SYSTEM_NOTIFICATIONS)) {
    const tNameLower = teacherName.toLowerCase();
    for (let i = SYSTEM_NOTIFICATIONS.length - 1; i >= 0; i--) {
      const n = SYSTEM_NOTIFICATIONS[i];
      if (n && n.desc && (n.desc.includes(targetId) || (tNameLower && n.desc.toLowerCase().includes(tNameLower)))) {
        SYSTEM_NOTIFICATIONS.splice(i, 1);
      }
    }
    saveCache('lms_notifications', SYSTEM_NOTIFICATIONS);
    try { localStorage.setItem('lms_notifications', JSON.stringify(SYSTEM_NOTIFICATIONS)); } catch (e) {}
  }

  renderApp();
  return true;
}

// Save teacher doc to Firestore.
// Returns true when the cloud write succeeded, false when it failed or
// Firestore is not available. A failed cloud write must NEVER be silent:
// callers await this and tell the user the record is local-only.
// The local cache is always updated first, so a cloud failure never loses data.
async function dbSaveTeacher(teacher) {
  if (!teacher || !teacher.id) return false;
  const idx = AppState.teachers.findIndex(t => t.id === teacher.id);
  if (idx >= 0) {
    AppState.teachers[idx] = teacher;
  } else {
    AppState.teachers.push(teacher);
  }
  saveCache('lms_teachers', AppState.teachers);

  if (!db) {
    firestoreSyncError = 'Firestore is not connected (database may not exist yet).';
    console.warn(`[Firestore] Teacher ${teacher.id} saved locally only: ${firestoreSyncError}`);
    return false;
  }
  try {
    await db.collection('teachers').doc(String(teacher.id)).set(teacher, { merge: true });
    console.log(`[Firestore] Teacher ${teacher.id} synced to Firestore`);
    return true;
  } catch (e) {
    firestoreSyncError = e.message;
    console.warn(`[Firestore] Error saving teacher ${teacher.id}:`, e.message);
    return false;
  }
}

// Save notice doc to Firestore
async function dbSaveNotice(notice) {
  if (!notice || !notice.id) return;
  const idx = ACADEMY_NOTICES.findIndex(n => n.id === notice.id);
  if (idx >= 0) {
    ACADEMY_NOTICES[idx] = notice;
  } else {
    ACADEMY_NOTICES.unshift(notice);
  }
  saveCache('lms_notices', ACADEMY_NOTICES);

  if (db) {
    try {
      await db.collection('notices').doc(String(notice.id)).set(notice, { merge: true });
      console.log(`[Firestore] Notice ${notice.id} synced to Firestore`);
    } catch (e) {
      console.warn(`[Firestore] Error saving notice ${notice.id}:`, e.message);
    }
  }
}

// Delete notice doc from Firestore & cache
async function dbDeleteNotice(noticeId) {
  if (!noticeId) return false;
  const notice = (ACADEMY_NOTICES || []).find(n =>
    n.id === noticeId ||
    String(n.id).trim().toLowerCase() === String(noticeId).trim().toLowerCase() ||
    ((noticeId === 'NOT-001' || noticeId === 'NOT-101') && (n.id === 'NOT-001' || n.id === 'NOT-101' || (n.title && n.title.includes('TEST Notice'))))
  );
  const targetId = notice ? notice.id : noticeId;

  // 1. If Firestore is active, delete notice doc and verify
  if (db) {
    try {
      await db.collection('notices').doc(String(targetId)).delete();
      if (targetId === 'NOT-101') {
        db.collection('notices').doc('NOT-001').delete().catch(() => {});
      }
      const verifySnap = await db.collection('notices').doc(String(targetId)).get();
      if (verifySnap.exists) {
        throw new Error('Notice could not be removed from cloud database.');
      }
      console.log(`[Firestore] Notice ${targetId} permanently deleted from Firestore`);
    } catch (e) {
      console.error(`[Firestore] Error deleting notice ${targetId}:`, e);
      showToastNotification(`Error deleting notice from cloud database: ${e.message}. Record retained.`);
      return false; // Do not remove from screen!
    }
  }

  // 2. Remove from ACADEMY_NOTICES
  for (let i = ACADEMY_NOTICES.length - 1; i >= 0; i--) {
    const n = ACADEMY_NOTICES[i];
    if (n && (n.id === targetId || String(n.id).trim().toLowerCase() === String(targetId).trim().toLowerCase() ||
        ((targetId === 'NOT-101' || targetId === 'NOT-001') && (n.id === 'NOT-001' || n.id === 'NOT-101' || (n.title && n.title.includes('TEST Notice')))))) {
      ACADEMY_NOTICES.splice(i, 1);
    }
  }
  saveCache('lms_notices', ACADEMY_NOTICES);
  try { localStorage.setItem('lms_notices', JSON.stringify(ACADEMY_NOTICES)); } catch (e) {}

  // Remove notice from notifications
  if (Array.isArray(SYSTEM_NOTIFICATIONS)) {
    for (let i = SYSTEM_NOTIFICATIONS.length - 1; i >= 0; i--) {
      const n = SYSTEM_NOTIFICATIONS[i];
      if (n && n.desc && (n.desc.includes(targetId) || (notice && notice.title && n.desc.includes(notice.title)))) {
        SYSTEM_NOTIFICATIONS.splice(i, 1);
      }
    }
    saveCache('lms_notifications', SYSTEM_NOTIFICATIONS);
    try { localStorage.setItem('lms_notifications', JSON.stringify(SYSTEM_NOTIFICATIONS)); } catch (e) {}
  }

  renderApp();
  return true;
}

// Save payment ledger transaction to Firestore
async function dbSavePaymentTransaction(tx) {
  if (!tx) return;
  const txId = tx.id || `TX-${Date.now()}`;
  tx.id = txId;
  PAYMENT_LEDGER.unshift(tx);
  saveCache('lms_payment_ledger', PAYMENT_LEDGER);

  if (db) {
    try {
      await db.collection('payment_ledger').doc(String(txId)).set(tx);
      console.log(`[Firestore] Payment transaction ${txId} synced to Firestore`);
    } catch (e) {
      console.warn(`[Firestore] Error saving payment ${txId}:`, e.message);
    }
  }
}

// Save trial pipeline lead to Firestore
async function dbSaveTrial(trial) {
  if (!trial) return;
  const trId = trial.id || `TR-${Date.now()}`;
  trial.id = trId;
  const idx = TRIAL_PIPELINE.findIndex(t => t.id === trId);
  if (idx >= 0) TRIAL_PIPELINE[idx] = trial;
  else TRIAL_PIPELINE.unshift(trial);
  saveCache('lms_trial_pipeline', TRIAL_PIPELINE);

  if (db) {
    try {
      await db.collection('trial_pipeline').doc(String(trId)).set(trial);
      console.log(`[Firestore] Trial lead ${trId} synced to Firestore`);
    } catch (e) {
      console.warn(`[Firestore] Error saving trial ${trId}:`, e.message);
    }
  }
}

// Save attendance log doc to Firestore & cache
async function dbSaveAttendanceLog(logDoc) {
  if (!logDoc || !logDoc.id) return;
  if (!AppState.attendanceLogs) AppState.attendanceLogs = [];
  const idx = AppState.attendanceLogs.findIndex(l => l.id === logDoc.id);
  if (idx >= 0) {
    AppState.attendanceLogs[idx] = logDoc;
  } else {
    AppState.attendanceLogs.unshift(logDoc);
  }
  saveCache('lms_attendance_logs', AppState.attendanceLogs);

  if (db) {
    try {
      await db.collection('attendance_logs').doc(String(logDoc.id)).set(logDoc, { merge: true });
      console.log(`[Firestore] Attendance log ${logDoc.id} synced to Firestore`);
    } catch (e) {
      console.warn(`[Firestore] Error saving attendance log ${logDoc.id}:`, e.message);
    }
  }
  if (typeof updateAttendanceVsPassChartSmoothly === 'function') {
    updateAttendanceVsPassChartSmoothly();
  }
}

// Save live class doc to Firestore & cache
async function dbSaveLiveClass(clsDoc) {
  if (!clsDoc || !clsDoc.id) return;
  if (!AppState.liveClasses) AppState.liveClasses = [];
  const idx = AppState.liveClasses.findIndex(c => c.id === clsDoc.id);
  if (idx >= 0) {
    AppState.liveClasses[idx] = clsDoc;
  } else {
    AppState.liveClasses.unshift(clsDoc);
  }
  saveCache('lms_live_classes', AppState.liveClasses);

  if (db) {
    try {
      await db.collection('live_classes').doc(String(clsDoc.id)).set(clsDoc, { merge: true });
      console.log(`[Firestore] Live class ${clsDoc.id} synced to Firestore`);
    } catch (e) {
      console.warn(`[Firestore] Error saving live class ${clsDoc.id}:`, e.message);
    }
  }
  if (AppState.activeNav === 'dashboard') {
    renderApp();
  }
}

// Delete live class doc from Firestore & cache
async function dbDeleteLiveClass(clsId) {
  if (!clsId) return;
  if (!AppState.liveClasses) AppState.liveClasses = [];
  AppState.liveClasses = AppState.liveClasses.filter(c => c.id !== clsId);
  saveCache('lms_live_classes', AppState.liveClasses);

  if (db) {
    try {
      await db.collection('live_classes').doc(String(clsId)).delete();
      console.log(`[Firestore] Live class ${clsId} deleted from Firestore`);
    } catch (e) {
      console.warn(`[Firestore] Error deleting live class ${clsId}:`, e.message);
    }
  }
  if (AppState.activeNav === 'dashboard') {
    renderApp();
  }
}

// Generic sync router that maps state arrays directly to Firestore collections
// Batch-sync a whole local collection to Firestore.
// Returns a Promise resolving to true when the cloud write succeeded,
// false when it failed or Firestore is not available. Callers that need
// to know the outcome must await it — a failure must never be silent.
async function syncCollectionToFirestore(key, data) {
  saveCache(key, data);

  if (!db || !Array.isArray(data)) return false;

  const collectionMap = {
    'lms_students': 'students',
    'lms_teachers': 'teachers',
    'lms_payment_ledger': 'payment_ledger',
    'lms_notices': 'notices',
    'lms_trial_pipeline': 'trial_pipeline',
    'lms_attendance_logs': 'attendance_logs',
    'lms_live_classes': 'live_classes'
  };

  const colName = collectionMap[key];
  if (!colName) return false;

  try {
    const batch = db.batch();
    data.forEach(item => {
      if (item && item.id) {
        const docRef = db.collection(colName).doc(String(item.id));
        batch.set(docRef, item, { merge: true });
      }
    });
    await batch.commit();
    return true;
  } catch (err) {
    firestoreSyncError = err && err.message;
    console.warn(`[Firestore] Batch sync failed for ${colName}:`, err);
    return false;
  }
}

// Storage adapter functions routing directly to Firestore sync.
// Returns the sync promise so callers can await the cloud outcome.
function saveToStorage(key, data) {
  return syncCollectionToFirestore(key, data);
}

function loadFromStorage(key, defaultData) {
  return loadCache(key, defaultData);
}

// Expose helpers globally
window.saveToStorage = saveToStorage;
window.loadFromStorage = loadFromStorage;
window.dbSaveStudent = dbSaveStudent;
window.dbDeleteStudent = dbDeleteStudent;
window.dbSaveTeacher = dbSaveTeacher;
window.dbDeleteTeacher = dbDeleteTeacher;
window.dbSaveNotice = dbSaveNotice;
window.dbDeleteNotice = dbDeleteNotice;
window.dbSavePaymentTransaction = dbSavePaymentTransaction;
window.dbSaveTrial = dbSaveTrial;
window.dbSaveAttendanceLog = dbSaveAttendanceLog;
window.dbSaveLiveClass = dbSaveLiveClass;
window.dbDeleteLiveClass = dbDeleteLiveClass;

// Real-Time Firestore onSnapshot Listeners
function setupFirestoreRealtimeListeners() {
  if (!db) {
    updateCloudSyncUI('fallback', 'Local Cache Active');
    return;
  }

  updateCloudSyncUI('connecting', 'Connecting Cloud...');

  // 1. STUDENTS COLLECTION REAL-TIME SYNC
  db.collection('students').onSnapshot((snapshot) => {
    isFirestoreConnected = true;
    updateCloudSyncUI('connected', 'Firestore Live');
    if (!snapshot.empty) {
      const liveList = [];
      snapshot.forEach(doc => {
        const item = doc.data();
        if (!item.id) item.id = doc.id;
        liveList.push(item);
      });
      AppState.students = liveList;
      saveCache('lms_students', liveList);
      try { localStorage.setItem('lms_students', JSON.stringify(liveList)); } catch (e) {}
      reconcileStudentsWithPaymentLedger();
      renderApp();
      if (typeof updateAttendanceVsPassChartSmoothly === 'function') {
        updateAttendanceVsPassChartSmoothly();
      }
    } else {
      // Empty cloud snapshot: NEVER wipe local data. An empty cloud can
      // mean the database does not exist yet, the listener has not caught
      // up, or the user is offline — none of those may delete the local
      // records on this device. Keep the local cache exactly as it is.
      console.warn('[Firestore] Students cloud snapshot is empty; keeping local data.');
    }
  }, (err) => {
    console.warn('[Firestore] Students listener warning:', err.code, err.message);
    firestoreSyncError = err.message;
    if (err.message && err.message.includes('API has not been used')) {
      updateCloudSyncUI('api_inactive', 'Firestore: Activate in Console');
    } else {
      updateCloudSyncUI('fallback', 'Local Cache Active');
    }
  });

  // 2. TEACHERS COLLECTION REAL-TIME SYNC
  db.collection('teachers').onSnapshot((snapshot) => {
    if (!snapshot.empty) {
      const liveList = [];
      snapshot.forEach(doc => {
        const item = doc.data();
        if (!item.id) item.id = doc.id;
        liveList.push(item);
      });
      AppState.teachers = liveList;
      saveCache('lms_teachers', liveList);
      try { localStorage.setItem('lms_teachers', JSON.stringify(liveList)); } catch (e) {}
      renderApp();
      // Cloud data replaces local on arrival: repair any wrong country
      // (Basit/Saad saved as Pakistan) in the fresh cloud copy too, and
      // write the correction back to Firestore.
      repairTeacherCountries();
    } else {
      // Empty cloud snapshot: NEVER wipe local data (see students listener).
      console.warn('[Firestore] Teachers cloud snapshot is empty; keeping local data.');
    }
  }, (err) => {
    console.warn('[Firestore] Teachers listener warning:', err.code, err.message);
  });

  // 3. PAYMENT LEDGER REAL-TIME SYNC
  db.collection('payment_ledger').onSnapshot((snapshot) => {
    if (!snapshot.empty) {
      PAYMENT_LEDGER.length = 0;
      snapshot.forEach(doc => {
        const item = doc.data();
        if (!item.id) item.id = doc.id;
        PAYMENT_LEDGER.push(item);
      });
      saveCache('lms_payment_ledger', PAYMENT_LEDGER);
      try { localStorage.setItem('lms_payment_ledger', JSON.stringify(PAYMENT_LEDGER)); } catch (e) {}
      reconcileStudentsWithPaymentLedger();
      if (AppState.activeNav === 'fee-matrix') renderFeeMatrixTab();
      else if (AppState.activeNav === 'dashboard') renderApp();
    } else {
      // Empty cloud snapshot: NEVER wipe local data (see students listener).
      console.warn('[Firestore] Payment ledger cloud snapshot is empty; keeping local data.');
    }
  }, (err) => {
    console.warn('[Firestore] Ledger listener warning:', err.code, err.message);
  });

  // 4. NOTICES COLLECTION REAL-TIME SYNC
  db.collection('notices').onSnapshot((snapshot) => {
    if (!snapshot.empty) {
      ACADEMY_NOTICES.length = 0;
      snapshot.forEach(doc => {
        const item = doc.data();
        if (!item.id) item.id = doc.id;
        ACADEMY_NOTICES.push(item);
      });
      saveCache('lms_notices', ACADEMY_NOTICES);
      try { localStorage.setItem('lms_notices', JSON.stringify(ACADEMY_NOTICES)); } catch (e) {}
      if (AppState.activeNav === 'trials-notices') renderTrialsNoticesTab();
    } else {
      // Empty cloud snapshot: NEVER wipe local data (see students listener).
      console.warn('[Firestore] Notices cloud snapshot is empty; keeping local data.');
    }
  }, (err) => {
    console.warn('[Firestore] Notices listener warning:', err.code, err.message);
  });

  // 5. TRIAL PIPELINE REAL-TIME SYNC
  db.collection('trial_pipeline').onSnapshot((snapshot) => {
    if (!snapshot.empty) {
      TRIAL_PIPELINE.length = 0;
      snapshot.forEach(doc => {
        const item = doc.data();
        if (!item.id) item.id = doc.id;
        TRIAL_PIPELINE.push(item);
      });
      saveCache('lms_trial_pipeline', TRIAL_PIPELINE);
      if (AppState.activeNav === 'trials-notices') renderTrialsNoticesTab();
    }
  }, (err) => {
    console.warn('[Firestore] Trial pipeline listener warning:', err.code, err.message);
  });

  // 6. ATTENDANCE LOGS REAL-TIME SYNC
  db.collection('attendance_logs').onSnapshot((snapshot) => {
    if (!snapshot.empty) {
      const liveLogs = [];
      snapshot.forEach(doc => liveLogs.push(doc.data()));
      AppState.attendanceLogs = liveLogs;
      saveCache('lms_attendance_logs', liveLogs);
      if (typeof updateAttendanceVsPassChartSmoothly === 'function') {
        updateAttendanceVsPassChartSmoothly();
      }
    }
  }, (err) => {
    console.warn('[Firestore] Attendance logs listener warning:', err.code, err.message);
  });

  // 7. LIVE CLASSES REAL-TIME SYNC
  db.collection('live_classes').onSnapshot((snapshot) => {
    if (!snapshot.empty) {
      const liveList = [];
      snapshot.forEach(doc => liveList.push(doc.data()));
      AppState.liveClasses = liveList;
      saveCache('lms_live_classes', liveList);
      if (AppState.activeNav === 'dashboard') {
        renderApp();
      }
    }
  }, (err) => {
    console.warn('[Firestore] Live classes listener warning:', err.code, err.message);
  });
}
window.setupFirestoreRealtimeListeners = setupFirestoreRealtimeListeners;

// ==========================================
// 1. MOCK DATABASE & INITIAL STATE
// ==========================================

const SEEDED_FLAG_KEY = 'lms_academy_seeded_permanent';

function isAcademyAlreadySeeded() {
  return localStorage.getItem(SEEDED_FLAG_KEY) === 'true';
}
window.isAcademyAlreadySeeded = isAcademyAlreadySeeded;

const BASELINE_SEED_STUDENTS = [
  {
    id: 'TEST-001',
    firstName: 'TEST Student',
    lastName: 'One',
    academicStatus: 'Active',
    guardianName: 'TEST Parent',
    phone: '+44 7700 900077',
    whatsapp: '+44 7700 900077',
    email: 'testparent@gmail.com',
    address: '10 Downing St, London',
    country: 'United Kingdom',
    timezone: 'GMT+0 (UTC)',
    familyId: 'TEST-FAM-001',
    familyTag: 'TEST-FAM-001',
    teacherId: 'TEST-T-001',
    teacherName: 'TEST Teacher One',
    assignedTeacher: 'TEST Teacher One',
    course: 'Nazira Quran',
    currency: '$',
    currencyCode: 'USD',
    monthlyFee: 50,
    enrollmentDate: '2026-11-01',
    weeklySchedule: {
      monday: { active: true, time: '17:00' },
      tuesday: { active: true, time: '17:00' },
      wednesday: { active: true, time: '17:00' },
      thursday: { active: true, time: '17:00' },
      friday: { active: false, time: '17:00' },
      saturday: { active: false, time: '17:00' },
      sunday: { active: false, time: '17:00' }
    }
  },
  {
    id: 'STU-101',
    firstName: 'Ahmed',
    lastName: 'Khan',
    academicStatus: 'Active',
    guardianName: 'Tariq Khan',
    phone: '+44 7891 234567',
    whatsapp: '+44 7891 234567',
    email: 'tariq.khan@gmail.com',
    address: '14 Crescent Road, London',
    country: 'United Kingdom',
    timezone: 'Europe/London',
    familyId: 'FAM-101',
    familyTag: 'FAM-101',
    teacherId: 'TCH-101',
    teacherName: 'Qari Abdul Basit',
    assignedTeacher: 'Qari Abdul Basit',
    course: 'Quran Memorization (Hifz)',
    currency: '$',
    currencyCode: 'USD',
    monthlyFee: 60,
    enrollmentDate: '2026-11-01',
    weeklySchedule: {
      monday: { active: true, time: '18:00' },
      tuesday: { active: true, time: '18:00' },
      wednesday: { active: true, time: '18:00' },
      thursday: { active: true, time: '18:00' },
      friday: { active: false, time: '18:00' },
      saturday: { active: false, time: '18:00' },
      sunday: { active: false, time: '18:00' }
    }
  },
  {
    id: 'STU-102',
    firstName: 'Ayesha',
    lastName: 'Siddiqui',
    academicStatus: 'Active',
    guardianName: 'Zubair Siddiqui',
    phone: '+1 202 555 0184',
    whatsapp: '+1 202 555 0184',
    email: 'zubair.siddiqui@gmail.com',
    address: '250 Park Ave, New York',
    country: 'United States',
    timezone: 'America/New_York',
    familyId: 'FAM-102',
    familyTag: 'FAM-102',
    teacherId: 'TCH-102',
    teacherName: 'Ustadha Maryam Khan',
    assignedTeacher: 'Ustadha Maryam Khan',
    course: 'Nazira Quran',
    currency: '$',
    currencyCode: 'USD',
    monthlyFee: 50,
    enrollmentDate: '2026-11-01',
    weeklySchedule: {
      monday: { active: true, time: '16:00' },
      tuesday: { active: false, time: '16:00' },
      wednesday: { active: true, time: '16:00' },
      thursday: { active: false, time: '16:00' },
      friday: { active: true, time: '16:00' },
      saturday: { active: false, time: '16:00' },
      sunday: { active: false, time: '16:00' }
    }
  },
  {
    id: 'STU-103',
    firstName: 'Umar',
    lastName: 'Farooq',
    academicStatus: 'Active',
    guardianName: 'Farooq Ahmed',
    phone: '+1 416 555 0192',
    whatsapp: '+1 416 555 0192',
    email: 'farooq.ahmed@gmail.com',
    address: '77 King St, Toronto',
    country: 'Canada',
    timezone: 'America/Toronto',
    familyId: 'FAM-103',
    familyTag: 'FAM-103',
    teacherId: 'TCH-102',
    teacherName: 'Ustadha Maryam Khan',
    assignedTeacher: 'Ustadha Maryam Khan',
    course: 'Islamic Studies & Ethics',
    currency: '$',
    currencyCode: 'USD',
    monthlyFee: 40,
    enrollmentDate: '2026-11-01',
    weeklySchedule: {
      monday: { active: false, time: '17:00' },
      tuesday: { active: true, time: '17:00' },
      wednesday: { active: false, time: '17:00' },
      thursday: { active: true, time: '17:00' },
      friday: { active: false, time: '17:00' },
      saturday: { active: true, time: '17:00' },
      sunday: { active: false, time: '17:00' }
    }
  }
];

const BASELINE_SEED_TEACHERS = [
  {
    id: 'TEST-T-001',
    name: 'TEST Teacher One',
    fatherName: 'Father One',
    cnic: '35201-1111111-1',
    isHafiz: false,
    certifiedHafiz: false,
    country: 'Pakistan',
    activeStudents: 1,
    hourlyRate: 20,
    rating: 5.0,
    status: 'Available',
    salaryStatus: 'Pending',
    phone: '+92 300 1111111',
    whatsapp: '+92 300 1111111',
    email: 'teacher1@quranicskills.com'
  },
  {
    id: 'TCH-101',
    name: 'Qari Abdul Basit',
    fatherName: 'Muhammad Ishaq',
    cnic: '35201-2222222-2',
    isHafiz: true,
    certifiedHafiz: true,
    country: 'United Kingdom',
    activeStudents: 1,
    hourlyRate: 25,
    rating: 5.0,
    status: 'Available',
    salaryStatus: 'Pending',
    phone: '+92 300 2222222',
    whatsapp: '+92 300 2222222',
    email: 'abdulbasit@quranicskills.com'
  },
  {
    id: 'TCH-102',
    name: 'Ustadha Maryam Khan',
    fatherName: 'Tariq Khan',
    cnic: '35201-3333333-3',
    isHafiz: false,
    certifiedHafiz: false,
    country: 'Pakistan',
    activeStudents: 2,
    hourlyRate: 22,
    rating: 5.0,
    status: 'Available',
    salaryStatus: 'Pending',
    phone: '+92 300 3333333',
    whatsapp: '+92 300 3333333',
    email: 'maryam.khan@quranicskills.com'
  },
  {
    id: 'TCH-103',
    name: 'Qari Saad Ahmed',
    fatherName: 'Ahmed Ali',
    cnic: '35201-4444444-4',
    isHafiz: true,
    certifiedHafiz: true,
    country: 'United Arab Emirates',
    activeStudents: 0,
    hourlyRate: 20,
    rating: 5.0,
    status: 'Available',
    salaryStatus: 'Pending',
    phone: '+92 300 4444444',
    whatsapp: '+92 300 4444444',
    email: 'saad.ahmed@quranicskills.com'
  }
];

const BASELINE_SEED_PAYMENTS = [
  {
    id: 'TXN-5683',
    date: '2026-11-24',
    studentId: 'TEST-001',
    studentName: 'TEST Student One',
    amount: 50,
    currency: '$',
    method: 'Online Card (Stripe)',
    type: 'Tuition Settlement',
    status: 'Completed',
    allocations: [
      {
        studentId: 'TEST-001',
        studentName: 'TEST Student One',
        currency: '$',
        monthIndex: 10,
        month: 'Nov',
        feeDue: 50,
        previouslyPaid: 0,
        allocatedAmount: 50,
        newAmountPaid: 50,
        newRemainingDue: 0,
        newStatus: 'paid',
        isAdvance: false
      }
    ],
    allocatedTo: 'Nov ($50 ➔ PAID)'
  },
  {
    id: 'TXN-3275',
    date: '2026-11-24',
    studentId: 'STU-101',
    studentName: 'Ahmed Khan',
    amount: 60,
    currency: '$',
    method: 'Online Card (Stripe)',
    type: 'Tuition Settlement',
    status: 'Completed',
    allocations: [
      {
        studentId: 'STU-101',
        studentName: 'Ahmed Khan',
        currency: '$',
        monthIndex: 10,
        month: 'Nov',
        feeDue: 60,
        previouslyPaid: 0,
        allocatedAmount: 60,
        newAmountPaid: 60,
        newRemainingDue: 0,
        newStatus: 'paid',
        isAdvance: false
      }
    ],
    allocatedTo: 'Nov ($60 ➔ PAID)'
  }
];

const BASELINE_SEED_NOTICE = {
  id: 'NOT-101',
  title: 'TEST Notice - Please Ignore',
  audience: 'All Students & Parents',
  author: 'Academy Admin',
  content: 'This is a test broadcast notice for validation purposes.',
  date: '2026-11-24',
  badge: 'Test'
};

const FIRESTORE_GET_TIMEOUT_MS = 8000;

// Firestore .get() has no built-in timeout: with long-polling enabled, a
// slow or unreachable Firestore can leave a .get() pending for minutes.
// Race every startup cloud read against a timeout so startup never waits
// on the network. Throws an Error('FIRESTORE_GET_TIMEOUT') on timeout.
function firestoreGetWithTimeout(getPromise) {
  return Promise.race([
    getPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('FIRESTORE_GET_TIMEOUT')), FIRESTORE_GET_TIMEOUT_MS))
  ]);
}

// Upload whatever real data this browser holds in its local cache to the
// cloud once, when the cloud is empty. Used when records were saved while
// Firestore was unreachable or did not exist yet, so other browsers and
// devices can see them. Additive only (merge:true) — it never deletes or
// overwrites cloud records, and it does nothing when the cloud already
// holds data or cannot be read.
async function uploadLocalCacheToCloud() {
  if (!db) return false;
  try {
    const existing = await firestoreGetWithTimeout(db.collection('students').limit(1).get());
    if (!existing.empty) return true; // cloud already has data; nothing to do
  } catch (e) {
    console.warn('[Sync] Local-to-cloud upload skipped; cloud check failed:', e.message);
    return false;
  }
  const uploads = [];
  const pushAll = (items, collection) => {
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      if (item && item.id) uploads.push(db.collection(collection).doc(String(item.id)).set(item, { merge: true }));
    });
  };
  pushAll(loadFromStorage('lms_students', []), 'students');
  pushAll(loadFromStorage('lms_teachers', []), 'teachers');
  pushAll(loadFromStorage('lms_payment_ledger', []), 'payment_ledger');
  pushAll(loadFromStorage('lms_notices', []), 'notices');
  if (!uploads.length) return true;
  try {
    await Promise.race([
      Promise.all(uploads),
      new Promise((resolve) => setTimeout(() => {
        console.warn('[Sync] Local-to-cloud upload timed out after 15s; continuing with local cache.');
        resolve();
      }, 15000))
    ]);
    console.log('[Sync] Local cache uploaded to Firestore.');
    return true;
  } catch (e) {
    console.warn('[Sync] Local-to-cloud upload failed:', e.message);
    return false;
  }
}

async function checkAndSeedInitialAcademyData() {
  if (isAcademyAlreadySeeded()) {
    console.log('[Seed] Academy already seeded. Skipping seed check.');
    // Background, best-effort: if this browser holds real local data but
    // the cloud is still empty, push it up once so other devices can see it.
    uploadLocalCacheToCloud().catch(() => {});
    return;
  }

  // True when the cloud check timed out: the cloud may still hold data, so
  // in that case we must NOT seed blindly and must NOT block startup.
  let cloudCheckTimedOut = false;
  // True when the cloud check itself failed (e.g. permission denied, API
  // not enabled): the cloud state is unknown, so we must NOT seed either.
  let cloudCheckFailed = false;

  if (db) {
    try {
      const metaDoc = await firestoreGetWithTimeout(db.collection('settings').doc('academy_meta').get());
      if (metaDoc.exists && metaDoc.data() && metaDoc.data().is_seeded) {
        localStorage.setItem(SEEDED_FLAG_KEY, 'true');
        console.log('[Seed] Cloud database already has is_seeded flag. Skipping seed.');
        return;
      }
      const existingStudents = await firestoreGetWithTimeout(db.collection('students').limit(1).get());
      if (!existingStudents.empty) {
        localStorage.setItem(SEEDED_FLAG_KEY, 'true');
        await db.collection('settings').doc('academy_meta').set({
          is_seeded: true,
          seeded_at: new Date().toISOString()
        }, { merge: true });
        console.log('[Seed] Cloud database already contains data. Marked seeded; skipping seed.');
        return;
      }
    } catch (e) {
      if (e && e.message === 'FIRESTORE_GET_TIMEOUT') {
        cloudCheckTimedOut = true;
        console.warn('[Seed] Firestore check timed out after 8s; using local cache only.');
      } else {
        cloudCheckFailed = true;
        console.warn('[Seed] Firestore check failed:', e.message);
      }
    }
  }

  if (cloudCheckTimedOut) {
    // Cloud unreachable right now — never seed blindly (the cloud may hold
    // data) and never block startup on it. Local cache only.
    return;
  }

  if (cloudCheckFailed) {
    // The cloud check itself failed (e.g. permission denied, Firestore API
    // not enabled). The cloud state is unknown, so do NOT fall through to
    // writing baseline seed data locally. Local cache only.
    console.warn('[Seed] Firestore check failed; not seeding baseline data.');
    return;
  }

  const cachedStudents = loadFromStorage('lms_students', null);
  const cachedTeachers = loadFromStorage('lms_teachers', null);
  if ((Array.isArray(cachedStudents) && cachedStudents.length > 0) ||
      (Array.isArray(cachedTeachers) && cachedTeachers.length > 0)) {
    // Real local data exists but the cloud is empty: upload the local
    // records to the cloud instead of overwriting them with baseline seed.
    localStorage.setItem(SEEDED_FLAG_KEY, 'true');
    if (db) {
      uploadLocalCacheToCloud().catch(() => {});
      db.collection('settings').doc('academy_meta').set({
        is_seeded: true,
        seeded_at: new Date().toISOString()
      }, { merge: true }).catch(() => {});
    }
    return;
  }

  console.log('[Seed] Fresh database detected. Writing baseline seed data ONCE...');
  AppState.students = JSON.parse(JSON.stringify(BASELINE_SEED_STUDENTS));
  AppState.teachers = JSON.parse(JSON.stringify(BASELINE_SEED_TEACHERS));
  PAYMENT_LEDGER.length = 0;
  BASELINE_SEED_PAYMENTS.forEach(p => PAYMENT_LEDGER.push(JSON.parse(JSON.stringify(p))));
  ACADEMY_NOTICES.length = 0;
  ACADEMY_NOTICES.push(JSON.parse(JSON.stringify(BASELINE_SEED_NOTICE)));

  saveCache('lms_students', AppState.students);
  saveCache('lms_teachers', AppState.teachers);
  saveCache('lms_payment_ledger', PAYMENT_LEDGER);
  saveCache('lms_notices', ACADEMY_NOTICES);

  try { localStorage.setItem('lms_students', JSON.stringify(AppState.students)); } catch (e) {}
  try { localStorage.setItem('lms_teachers', JSON.stringify(AppState.teachers)); } catch (e) {}
  try { localStorage.setItem('lms_payment_ledger', JSON.stringify(PAYMENT_LEDGER)); } catch (e) {}
  try { localStorage.setItem('lms_notices', JSON.stringify(ACADEMY_NOTICES)); } catch (e) {}

  if (db) {
    try {
      const batchPromises = [];
      for (const st of AppState.students) {
        batchPromises.push(db.collection('students').doc(st.id).set(st, { merge: true }));
      }
      for (const tc of AppState.teachers) {
        batchPromises.push(db.collection('teachers').doc(tc.id).set(tc, { merge: true }));
      }
      for (const pm of PAYMENT_LEDGER) {
        batchPromises.push(db.collection('payment_ledger').doc(pm.id).set(pm, { merge: true }));
      }
      batchPromises.push(db.collection('notices').doc(BASELINE_SEED_NOTICE.id).set(BASELINE_SEED_NOTICE, { merge: true }));
      batchPromises.push(db.collection('settings').doc('academy_meta').set({
        is_seeded: true,
        seeded_at: new Date().toISOString()
      }, { merge: true }));

      // Time-box the background seed write too: it must never hang forever
      // if Firestore is slow — the app already rendered from local cache.
      await Promise.race([
        Promise.all(batchPromises),
        new Promise((resolve) => setTimeout(() => {
          console.warn('[Seed] Firestore seed write timed out after 15s; continuing with local cache.');
          resolve();
        }, 15000))
      ]);
      console.log('[Seed] Baseline data seeded to Firestore successfully.');
    } catch (e) {
      console.warn('[Seed] Warning saving seed to Firestore:', e.message);
    }
  }

  localStorage.setItem(SEEDED_FLAG_KEY, 'true');
}

const _systemCurrentDate = new Date();
const MONTHS_LIST = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS_LIST = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const CANONICAL_COURSES = [
  'Qaida for Beginners',
  'Nazira Quran',
  'Tajweed & Makharij',
  'Quran Memorization (Hifz)',
  'Quran Translation & Tafseer',
  'Arabic Language',
  'Urdu Language',
  'New Muslim Essentials',
  'Islamic Studies & Ethics'
];
window.CANONICAL_COURSES = CANONICAL_COURSES;
let CURRENT_MONTH_INDEX = _systemCurrentDate.getMonth(); // Dynamically detects current system month (0-indexed: 0=Jan, 10=Nov, etc.)
let CURRENT_YEAR = _systemCurrentDate.getFullYear(); // Dynamically detects current system year (e.g., 2026)

const INITIAL_TEACHERS = loadFromStorage('lms_teachers', []);

const INITIAL_STUDENTS = loadFromStorage('lms_students', []);

// Active Live Classes for Radar & Sessions
const LIVE_CLASSES_RADAR = [];
const UPCOMING_SESSIONS = [];
const ACTIVE_CLASSES = [];

// Trial Pipeline (Starts with 0 records or persistent storage)
const TRIAL_PIPELINE = loadFromStorage('lms_trial_pipeline', []);

// Academy Public & Portal Announcements (Starts with 0 records or persistent storage)
const ACADEMY_NOTICES = loadFromStorage('lms_notices', []);
window.ACADEMY_NOTICES = ACADEMY_NOTICES;

// Ledger Transactions History (Starts with 0 records or persistent storage)
const PAYMENT_LEDGER = loadFromStorage('lms_payment_ledger', []);
window.PAYMENT_LEDGER = PAYMENT_LEDGER;

function getTodayYMD() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
window.getTodayYMD = getTodayYMD;

/**
 * Checks if target ID represents a family group rather than a single individual student
 */
function isFamilyTarget(targetId) {
  if (!targetId || typeof targetId !== 'string') return false;
  const isDirectStudent = (AppState.students || []).some(s => s.id === targetId);
  if (isDirectStudent) return false;
  return (AppState.students || []).some(s => s.familyId === targetId || s.familyTag === targetId) || targetId.startsWith('FAM-');
}
window.isFamilyTarget = isFamilyTarget;

/**
 * Avatar Clean Name & URL Generation
 * Fixes Bug 6: Strips honorifics (Ustadha, Ustadh, Qari, Sheikh, etc.)
 * so avatar initials represent the person's real first and last name (e.g. Maryam Khan -> MK).
 */
function getAvatarCleanName(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'User';
  let clean = rawName.trim();
  const honorificRegex = /^(ustadha|ustadh|ustad|qari|sheikh|shaykh|hafiza|hafiz|mufti|alima|alim|dr\.|dr|mr\.|mr|mrs\.|mrs|ms\.|ms|miss|al-hafiz|al-qari|syed|sayyid)\s+/i;
  while (honorificRegex.test(clean)) {
    clean = clean.replace(honorificRegex, '').trim();
  }
  return clean || rawName.trim();
}
window.getAvatarCleanName = getAvatarCleanName;

function getAvatarUrl(rawName, bg = '0E4D45', color = 'fff') {
  const cleanName = getAvatarCleanName(rawName);
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanName)}&background=${bg}&color=${color}`;
}
window.getAvatarUrl = getAvatarUrl;

/**
 * Determines a student's actual enrollment academic month index (0-11).
 * Fixes Bug 2: Enrolment starts from actual enrolment month, not backdated to January.
 */
function getStudentEnrollmentMonth(student) {
  if (typeof student?.enrollmentMonthIndex === 'number' && student.enrollmentMonthIndex >= 0 && student.enrollmentMonthIndex < 12) {
    return student.enrollmentMonthIndex;
  }
  const dateStr = student?.enrollmentDate || student?.joinDate || student?.admissionDate || student?.enrolledDate || student?.createdAt;
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.getMonth();
    }
  }
  return CURRENT_MONTH_INDEX;
}
window.getStudentEnrollmentMonth = getStudentEnrollmentMonth;

/**
 * Repairs stored payments whose allocations add up to MORE than the amount
 * actually received. A payment record is a historical fact: the allocations
 * recorded against it must never exceed what was paid. If a doc is
 * over-allocated, allocations are trimmed from the newest one backward
 * until the sum equals the received amount, and the human-readable summary
 * is rebuilt from what remains. Docs that already add up are left exactly
 * as they are, no payment record is ever deleted, and running this again is
 * a no-op — so it is safe to run on every reconcile. The corrected doc is
 * persisted through the existing Firestore doc-set path (never through
 * dbSavePaymentTransaction, which unshifts a NEW transaction).
 */
function repairOverAllocatedPayments() {
  if (!Array.isArray(PAYMENT_LEDGER)) return 0;
  let repaired = 0;
  PAYMENT_LEDGER.forEach(p => {
    if (!p || !Array.isArray(p.allocations) || p.allocations.length === 0) return;
    const received = Number(p.amount) || 0;
    let total = 0;
    p.allocations.forEach(a => { total += Number(a.allocatedAmount) || 0; });
    if (total <= received) return;
    let excess = Math.round((total - received) * 100) / 100;
    // Trim from the newest allocation backward until the sum equals received.
    for (let i = p.allocations.length - 1; i >= 0 && excess > 0; i--) {
      const a = p.allocations[i];
      const alloc = Number(a.allocatedAmount) || 0;
      if (alloc <= 0) continue;
      const cut = Math.min(alloc, excess);
      const next = Math.round((alloc - cut) * 100) / 100;
      excess = Math.round((excess - cut) * 100) / 100;
      if (next <= 0) {
        p.allocations.splice(i, 1);
      } else {
        a.allocatedAmount = next;
        a.newAmountPaid = Math.round(((Number(a.previouslyPaid) || 0) + next) * 100) / 100;
        a.newRemainingDue = Math.max(0, Math.round(((Number(a.feeDue) || 0) - a.newAmountPaid) * 100) / 100);
        a.newStatus = a.newRemainingDue === 0 ? 'paid' : 'partial';
      }
    }
    // Rebuild the human-readable summary from the remaining allocations.
    const isFamilyDoc = String(p.type || '') === 'Family Combined Invoice' ||
      (AppState.students || []).some(s => String(s.familyId || s.familyTag || '').trim().toLowerCase() === String(p.studentId || '').trim().toLowerCase());
    p.allocatedTo = p.allocations.map(a => {
      const amt = Number(a.allocatedAmount) || 0;
      const st = String(a.newStatus || 'paid').toUpperCase();
      const cur = a.currency || p.currency || '$';
      return isFamilyDoc
        ? `${String(a.studentName || '').split(' ')[0]} ${a.month} (${cur}${amt} ➔ ${st})`
        : `${a.month} (${cur}${amt} ➔ ${st})`;
    }).join(', ');
    repaired++;
    // Persist the corrected record through the existing Firestore doc path.
    try {
      if (typeof db !== 'undefined' && db) {
        db.collection('payment_ledger').doc(String(p.id)).set(p, { merge: true }).catch(e => console.warn('[Repair] Could not persist trimmed payment', p.id, e && e.message));
      }
    } catch (e) {
      console.warn('[Repair] Could not persist trimmed payment', p.id, e && e.message);
    }
  });
  if (repaired > 0) {
    try { saveCache('lms_payment_ledger', PAYMENT_LEDGER); } catch (e) {}
    console.log(`[Repair] Trimmed ${repaired} over-allocated payment(s) back to the amount received.`);
  }
  return repaired;
}
window.repairOverAllocatedPayments = repairOverAllocatedPayments;

/**
 * What ONE student paid on their own for one month, from payment docs
 * addressed to that student. An allocation counts for a student ONLY when
 * it carries their exact student id (or carries no id at all on a payment
 * addressed to them). The old loose check — allocation studentName
 * containing the student's first name — is gone: firstName is only the
 * first word of the name (e.g. "PKG"), so every allocation of a family
 * matched every child and each child was credited with the whole family
 * payment. Family payment docs are never counted here; they are spread by
 * computeFamilyPoolCredits below.
 */
function getIndividualPaidForMonth(student, idx, familyKeys) {
  const shortM = MONTHS_LIST[idx];
  const fullM = FULL_MONTHS_LIST[idx];
  const sId = String(student.id || '').trim().toLowerCase();
  const fullName = `${student.firstName} ${student.lastName || ''}`.trim().toLowerCase();
  let paid = 0;
  let doc = null;
  (PAYMENT_LEDGER || []).forEach(p => {
    if (!p) return;
    const pId = String(p.studentId || '').trim().toLowerCase();
    if (familyKeys && familyKeys.has(pId)) return; // family doc: handled by the pool
    const pName = String(p.studentName || '').trim().toLowerCase();
    // Individual doc: addressed to this student by id, or (legacy docs with
    // no id at all) by full name. A first-name-only match is NOT enough.
    const isIndividualDoc = (pId !== '' && pId === sId) || (pId === '' && fullName !== '' && pName.includes(fullName));
    if (!isIndividualDoc) return;
    if (Array.isArray(p.allocations) && p.allocations.length > 0) {
      p.allocations.forEach(a => {
        if (a.monthIndex === idx || a.month === shortM || a.month === fullM) {
          if (!a.studentId || String(a.studentId).trim().toLowerCase() === sId) {
            paid += Number(a.allocatedAmount) || 0;
            doc = p;
          }
        }
      });
    } else if (p.allocatedTo && (p.allocatedTo.includes(shortM) || p.allocatedTo.includes(fullM))) {
      paid += Number(p.amount) || 0;
      doc = p;
    } else if (p.date) {
      const d = new Date(p.date);
      if (!isNaN(d.getTime()) && d.getMonth() === idx) {
        paid += Number(p.amount) || 0;
        doc = p;
      }
    }
  });
  return { paid: Math.round(paid * 100) / 100, doc };
}

/**
 * Spreads what each family RECEIVED for a month across its children in list
 * order, capped at the received total. A family payment is one pool of
 * money, not one payment per child: the pool covers the first children in
 * order (each up to their current share, less anything they already paid on
 * their own), and whatever is left short stays due on the newest member(s).
 * Example: 6 children x $10 owed, $50 received -> five children Paid $10,
 * the newest child due $10. With $50 received for 5 children x $10, all
 * five stay Paid. Months before a child's enrolment consume nothing.
 * Returns Map: `${familyKey}|${monthIdx}` -> Map(studentId -> { credit, doc }).
 */
function computeFamilyPoolCredits(individualPaid, familyKeys) {
  const credits = new Map();
  const families = {};
  (AppState.students || []).forEach(s => {
    const key = String(s.familyId || s.familyTag || '').trim().toLowerCase();
    if (!key) return;
    (families[key] = families[key] || []).push(s);
  });
  Object.keys(families).forEach(famKey => {
    const members = families[famKey];
    const famDocs = (PAYMENT_LEDGER || []).filter(p => p && String(p.studentId || '').trim().toLowerCase() === famKey);
    if (famDocs.length === 0) return;
    for (let idx = 0; idx < 12; idx++) {
      const shortM = MONTHS_LIST[idx];
      const fullM = FULL_MONTHS_LIST[idx];
      let pool = 0;
      let poolDoc = null;
      famDocs.forEach(p => {
        if (Array.isArray(p.allocations) && p.allocations.length > 0) {
          let docMonthSum = 0;
          p.allocations.forEach(a => {
            if (a.monthIndex === idx || a.month === shortM || a.month === fullM) docMonthSum += Number(a.allocatedAmount) || 0;
          });
          if (docMonthSum > 0) {
            // One doc can never credit more than was received for it.
            pool += Math.min(docMonthSum, Number(p.amount) || docMonthSum);
            poolDoc = p;
          }
        } else if (p.allocatedTo && (p.allocatedTo.includes(shortM) || p.allocatedTo.includes(fullM))) {
          pool += Number(p.amount) || 0;
          poolDoc = p;
        } else if (p.date) {
          const d = new Date(p.date);
          if (!isNaN(d.getTime()) && d.getMonth() === idx) {
            pool += Number(p.amount) || 0;
            poolDoc = p;
          }
        }
      });
      if (pool <= 0) continue;
      let remaining = Math.round(pool * 100) / 100;
      const creditMap = new Map();
      members.forEach(s => {
        if (remaining <= 0) return;
        if (idx < getStudentEnrollmentMonth(s)) return; // not enrolled yet: owes nothing, consumes nothing
        const share = Number(s.monthlyFee) || 0;
        const indiv = individualPaid.get(s.id + '|' + idx);
        const alreadyPaid = indiv ? (indiv.paid || 0) : 0;
        const need = Math.max(0, Math.round((share - alreadyPaid) * 100) / 100);
        if (need <= 0) return;
        const credit = Math.min(remaining, need);
        remaining = Math.round((remaining - credit) * 100) / 100;
        if (credit > 0) creditMap.set(s.id, { credit, doc: poolDoc });
      });
      if (creditMap.size > 0) credits.set(famKey + '|' + idx, creditMap);
    }
  });
  return credits;
}

/**
 * Reconciles each student's 12-month billing records with actual ledger payments.
 * A month is ONLY marked as 'paid' or 'partial' if a verified payment transaction exists in PAYMENT_LEDGER.
 * Months prior to student enrollment are marked 'not_enrolled' with 0 balance due.
 * Unpaid past/current enrolled months are marked 'defaulter' with balance due; future months remain 'upcoming'.
 * Allocation rule: a recorded payment is never credited for more than was
 * actually received. Individual payments are matched by exact student id;
 * family payments are one pool spread across the children in list order and
 * capped at the received total, so a new child joining a family whose month
 * is already paid stays due for their share until the family pays the
 * difference.
 */
function reconcileStudentsWithPaymentLedger() {
  if (!AppState || !Array.isArray(AppState.students)) return;

  // Fix any stored payment whose allocations exceed what was received,
  // before deriving months from it.
  repairOverAllocatedPayments();

  // Family keys, for telling family payment docs apart from individual ones.
  const familyKeys = new Set();
  AppState.students.forEach(s => {
    const key = String(s.familyId || s.familyTag || '').trim().toLowerCase();
    if (key) familyKeys.add(key);
  });

  // 1) What each student paid on their own (exact allocation match only).
  const individualPaid = new Map();
  AppState.students.forEach(student => {
    for (let idx = 0; idx < 12; idx++) {
      const entry = getIndividualPaidForMonth(student, idx, familyKeys);
      if (entry.paid > 0) individualPaid.set(student.id + '|' + idx, entry);
    }
  });

  // 2) What each family received, spread across its children in list order
  // and capped at the received total — the shortfall stays due on the
  // newest member(s).
  const familyCredits = computeFamilyPoolCredits(individualPaid, familyKeys);

  AppState.students.forEach(student => {
    // Reconcile faculty assignment if teacherId exists but teacherName missing
    if (student.teacherId && (!student.teacherName || student.teacherName === 'Unassigned')) {
      const matchT = (AppState.teachers || []).find(t => 
        t.id === student.teacherId || 
        (t.id && t.id.toLowerCase() === student.teacherId.toLowerCase()) ||
        t.name === student.teacherId
      );
      if (matchT) {
        student.teacherName = matchT.name;
        student.assignedTeacher = matchT.name;
      }
    }

    const enrollMonth = getStudentEnrollmentMonth(student);

    if (!Array.isArray(student.months) || student.months.length !== 12) {
      student.months = MONTHS_LIST.map((m, idx) => ({
        month: m,
        status: idx < enrollMonth ? 'not_enrolled' : (idx > CURRENT_MONTH_INDEX ? 'upcoming' : 'defaulter'),
        feeDue: idx < enrollMonth ? 0 : (Number(student.monthlyFee) || 50),
        amountPaid: 0,
        remainingDue: idx < enrollMonth ? 0 : (Number(student.monthlyFee) || 50)
      }));
    }

    student.months.forEach((m, idx) => {
      const monthlyFee = Number(student.monthlyFee || 50);

      // What this student paid on their own, plus their share of the
      // family's received pool for this month (capped at what was received;
      // the pool is spread in list order, so any shortfall lands on the
      // newest member).
      const indiv = individualPaid.get(student.id + '|' + idx);
      const famKey = String(student.familyId || student.familyTag || '').trim().toLowerCase();
      const famMap = famKey ? familyCredits.get(famKey + '|' + idx) : null;
      const famEntry = famMap ? famMap.get(student.id) : null;
      let totalPaidForMonth = Math.round(((indiv ? indiv.paid : 0) + (famEntry ? famEntry.credit : 0)) * 100) / 100;
      let matchedPayDoc = null;
      if (famEntry && famEntry.credit > 0) matchedPayDoc = famEntry.doc;
      else if (indiv && indiv.paid > 0) matchedPayDoc = indiv.doc;

      if (idx < enrollMonth && totalPaidForMonth === 0) {
        // Enrolment starts from actual enrolment month; no backdated months are owed
        m.status = 'not_enrolled';
        m.feeDue = 0;
        m.amountPaid = 0;
        m.remainingDue = 0;
        m.receiptNo = null;
        m.paymentDate = null;
        m.paymentMethod = null;
      } else if (totalPaidForMonth >= monthlyFee && monthlyFee > 0) {
        m.status = idx > CURRENT_MONTH_INDEX ? 'advance' : 'paid';
        m.feeDue = monthlyFee;
        m.amountPaid = monthlyFee;
        m.remainingDue = 0;
        m.receiptNo = matchedPayDoc ? matchedPayDoc.id : null;
        m.paymentDate = matchedPayDoc ? matchedPayDoc.date : '2026-11-24';
        m.paymentMethod = matchedPayDoc ? matchedPayDoc.method : 'Online Card (Stripe)';
      } else if (totalPaidForMonth > 0) {
        m.status = 'partial';
        m.feeDue = monthlyFee;
        m.amountPaid = totalPaidForMonth;
        m.remainingDue = Math.max(0, monthlyFee - totalPaidForMonth);
        m.receiptNo = matchedPayDoc ? matchedPayDoc.id : null;
        m.paymentDate = matchedPayDoc ? matchedPayDoc.date : '2026-11-24';
        m.paymentMethod = matchedPayDoc ? matchedPayDoc.method : 'Online Card (Stripe)';
      } else {
        m.status = idx > CURRENT_MONTH_INDEX ? 'upcoming' : 'defaulter';
        m.feeDue = monthlyFee;
        m.amountPaid = 0;
        m.remainingDue = monthlyFee;
        m.receiptNo = null;
        m.paymentDate = null;
        m.paymentMethod = null;
      }
    });
  });
}
window.reconcileStudentsWithPaymentLedger = reconcileStudentsWithPaymentLedger;

/**
 * Calculates fee collected for a specific academic month and year from real payments.
 */
function getMonthFeeCollected(monthIndex, year) {
  const shortM = MONTHS_LIST[monthIndex];
  const fullM = FULL_MONTHS_LIST[monthIndex];
  let sum = 0;

  if (Array.isArray(PAYMENT_LEDGER) && PAYMENT_LEDGER.length > 0) {
    PAYMENT_LEDGER.forEach(p => {
      if (!p) return;
      if (Array.isArray(p.allocations) && p.allocations.length > 0) {
        p.allocations.forEach(a => {
          if (a.monthIndex === monthIndex || a.month === shortM || a.month === fullM) {
            sum += Number(a.allocatedAmount || 0);
          }
        });
      } else if (p.allocatedTo && (p.allocatedTo.includes(shortM) || p.allocatedTo.includes(fullM))) {
        sum += Number(p.amount || 0);
      } else if (p.date) {
        const d = new Date(p.date);
        if (!isNaN(d.getTime()) && d.getMonth() === monthIndex && (!year || d.getFullYear() === year)) {
          sum += Number(p.amount || 0);
        }
      }
    });
    return sum;
  }

  (AppState.students || []).forEach(s => {
    if (Array.isArray(s.months) && s.months[monthIndex]) {
      sum += Number(s.months[monthIndex].amountPaid || 0);
    }
  });
  return sum;
}
window.getMonthFeeCollected = getMonthFeeCollected;

// App State
const AppState = {
  currentRole: 'admin', // 'admin' | 'manager' | 'teacher' | 'student'
  activeNav: 'dashboard', // 'dashboard' | 'fee-matrix' | 'students' | 'teachers' | 'trials-notices' | 'library'
  selectedFilter: 'all', // 'all' | 'paid' | 'partial' | 'advance' | 'defaulter'
  groupByFamily: true,
  collapsedFamilies: {},
  selectedCurrency: 'all',
  searchQuery: '',
  studentDirectoryStatusFilter: 'all', // 'all' | 'Active' | 'On Trial' | 'On Leave' | 'Inactive'
  studentDirectoryCountryFilter: 'all',
  studentDirectorySearchQuery: '',
  activeStudentActionMenuId: null,
  activeLedgerActionMenuId: null,
  activeNoticeActionMenuId: null,
  activeStudentSchedulePopoverId: null,
  activeStudentContactPopoverId: null,
  currentMonthIndex: CURRENT_MONTH_INDEX,
  currentYear: CURRENT_YEAR,
  attendanceTimeframe: 'month', // 'week' | 'month' | 'year'
  attendanceSelectedYear: CURRENT_YEAR,
  attendanceLogs: loadFromStorage('lms_attendance_logs', []),
  students: loadFromStorage('lms_students', []),
  teachers: loadFromStorage('lms_teachers', []),
  liveClasses: loadFromStorage('lms_live_classes', []),
  liveClassSearch: '',
  liveClassDate: getTodayYMD(),
  liveClassFilterOpen: false,
  liveClassFilters: {
    teacher: 'all',
    country: 'all',
    status: 'all',
    type: 'all'
  },
  liveClassShowAllToday: false,
  selectedSiblingId: 'QA-1021', // For parent portal
  modalState: {
    receiveFeeOpen: false,
    sabaqLoggerOpen: false,
    substituteModalOpen: false,
    receiptModalOpen: false,
    systemReminderModalOpen: false,
    addStudentModalOpen: false,
    addTeacherModalOpen: false
  },
  activeModalData: null
};
window.AppState = AppState;

// ==========================================
// SHARED REUSABLE COMPONENT PATTERNS
// (Unified Across Admin, Manager, Teacher & Parent Portals)
// Strictly adhering to Dark-Teal (#0E4D45) & Warm Cream (#F9F8F5) Theme
// ==========================================

// Initialize Extended Shared State
AppState.selectedStudentIds = new Set();
AppState.studentDirectoryCourseFilter = 'all';
AppState.studentDirectoryTeacherFilter = 'all';
AppState.studentDirectoryFeeFilter = 'all';
AppState.teacherPayrollSpecFilter = 'all';
AppState.teacherPayrollStatusFilter = 'all';
AppState.commandPaletteOpen = false;
AppState.commandPaletteSelectedIndex = 0;
AppState.lastFailedAction = null;
AppState.tableSortState = {};
AppState.tablePaginationState = {};

// 1. Debouncing and Throttling Utilities
function debounce(fn, wait = 250) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}
window.debounce = debounce;

function throttle(fn, limit = 250) {
  let inThrottle = false;
  return function(...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}
window.throttle = throttle;

// 2. Skeleton Loaders Component
function renderSkeletonLoader({ type = 'table', count = 4, columns = 5 } = {}) {
  if (type === 'kpi') {
    return `
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        ${Array.from({ length: 5 }).map(() => `
          <div class="p-4 bg-white rounded-2xl border border-[#ECEAE4] shadow-xs">
            <div class="w-24 h-3.5 skeleton-shimmer mb-3"></div>
            <div class="w-16 h-7 skeleton-shimmer mb-2"></div>
            <div class="w-32 h-3 skeleton-shimmer"></div>
          </div>
        `).join('')}
      </div>
    `;
  }
  if (type === 'cards') {
    return `
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        ${Array.from({ length: count || 3 }).map(() => `
          <div class="p-5 bg-white rounded-2xl border border-[#ECEAE4] shadow-xs space-y-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full skeleton-shimmer shrink-0"></div>
              <div class="space-y-1.5 flex-1">
                <div class="w-3/4 h-4 skeleton-shimmer"></div>
                <div class="w-1/2 h-3 skeleton-shimmer"></div>
              </div>
            </div>
            <div class="w-full h-8 skeleton-shimmer rounded-xl"></div>
          </div>
        `).join('')}
      </div>
    `;
  }
  if (type === 'dashboard') {
    return `
      <div class="space-y-6">
        ${renderSkeletonLoader({ type: 'kpi' })}
        <div class="p-6 bg-white rounded-2xl border border-[#ECEAE4] shadow-xs space-y-4">
          <div class="flex items-center justify-between pb-3 border-b border-[#ECEAE4]">
            <div class="w-48 h-5 skeleton-shimmer"></div>
            <div class="w-24 h-7 skeleton-shimmer rounded-full"></div>
          </div>
          <div class="space-y-3">
            <div class="w-full h-12 skeleton-shimmer rounded-xl"></div>
            <div class="w-full h-12 skeleton-shimmer rounded-xl"></div>
            <div class="w-full h-12 skeleton-shimmer rounded-xl"></div>
          </div>
        </div>
      </div>
    `;
  }
  // Default: 'table'
  return `
    <div class="w-full bg-white rounded-2xl border border-[#ECEAE4] overflow-hidden shadow-xs">
      <div class="p-4 border-b border-[#ECEAE4] flex items-center justify-between bg-[#F8F6F1]">
        <div class="w-36 h-4 skeleton-shimmer"></div>
        <div class="w-28 h-6 skeleton-shimmer rounded-full"></div>
      </div>
      <div class="p-4 space-y-3">
        <div class="grid grid-cols-${columns} gap-3 pb-2 border-b border-[#ECEAE4]">
          ${Array.from({ length: columns }).map(() => `<div class="h-3.5 skeleton-shimmer"></div>`).join('')}
        </div>
        ${Array.from({ length: count || 4 }).map(() => `
          <div class="grid grid-cols-${columns} gap-3 py-2 border-b border-[#F8F6F1]">
            ${Array.from({ length: columns }).map(() => `<div class="h-4 skeleton-shimmer"></div>`).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}
window.renderSkeletonLoader = renderSkeletonLoader;

function showSharedSkeleton(tabId) {
  const container = document.getElementById('main-dynamic-content');
  if (!container) return;
  if (tabId === 'dashboard') container.innerHTML = renderSkeletonLoader({ type: 'dashboard' });
  else if (tabId === 'teachers') container.innerHTML = renderSkeletonLoader({ type: 'cards', count: 4 });
  else container.innerHTML = renderSkeletonLoader({ type: 'table', count: 5 });
}
window.showSharedSkeleton = showSharedSkeleton;

// 3. Loading and Empty States Component
function renderSharedEmptyState({ 
  icon = 'search', 
  title = 'No records found', 
  description = 'There are currently no items matching your criteria.',
  actionText = '', 
  actionFn = '',
  secondaryActionText = '',
  secondaryActionFn = ''
} = {}) {
  let iconSvg = `<svg class="w-6 h-6 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>`;
  if (icon === 'user') {
    iconSvg = `<svg class="w-6 h-6 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>`;
  } else if (icon === 'teacher' || icon === 'payroll') {
    iconSvg = `<svg class="w-6 h-6 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>`;
  } else if (icon === 'fee' || icon === 'ledger') {
    iconSvg = `<svg class="w-6 h-6 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  } else if (icon === 'calendar' || icon === 'schedule') {
    iconSvg = `<svg class="w-6 h-6 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`;
  } else if (icon === 'notice') {
    iconSvg = `<svg class="w-6 h-6 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>`;
  }

  return `
    <div class="py-12 px-6 text-center bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4] my-2">
      <div class="w-12 h-12 rounded-full bg-[#E8EFEE] flex items-center justify-center mx-auto mb-3 shadow-2xs">
        ${iconSvg}
      </div>
      <h3 class="text-xs sm:text-sm font-bold text-[#141F1E]">${title}</h3>
      <p class="text-[11px] text-[#7A8684] mt-1 mb-4 max-w-sm mx-auto leading-relaxed">${description}</p>
      <div class="flex items-center justify-center gap-2.5 flex-wrap">
        ${actionText && actionFn ? `
          <button type="button" onclick="${actionFn}" class="px-4 py-2 text-xs font-bold rounded-xl bg-[#0E4D45] text-white hover:bg-[#14534B] transition-colors shadow-2xs cursor-pointer flex items-center gap-1.5">
            <span>${actionText}</span>
          </button>
        ` : ''}
        ${secondaryActionText && secondaryActionFn ? `
          <button type="button" onclick="${secondaryActionFn}" class="px-3.5 py-2 text-xs font-semibold rounded-xl bg-white border border-[#ECEAE4] text-[#334E4B] hover:text-[#0E4D45] hover:bg-[#E8EFEE] transition-colors cursor-pointer">
            ${secondaryActionText}
          </button>
        ` : ''}
      </div>
    </div>
  `;
}
window.renderSharedEmptyState = renderSharedEmptyState;

// 4. Smart Form Validation Helpers
function setFormFieldError(inputElOrId, message) {
  const el = typeof inputElOrId === 'string' ? document.getElementById(inputElOrId) : inputElOrId;
  if (!el) return;

  el.classList.add('field-error');
  el.classList.add('border-[#DC2626]');
  el.classList.add('ring-1');
  el.classList.add('ring-[#DC2626]');

  clearFormFieldError(el, false);

  const errorDiv = document.createElement('div');
  errorDiv.className = 'shared-field-error-msg';
  errorDiv.innerHTML = `
    <svg class="w-3.5 h-3.5 shrink-0 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
    <span>${message}</span>
  `;

  if (el.parentNode) {
    el.parentNode.insertBefore(errorDiv, el.nextSibling);
  }

  const clearHandler = function() {
    clearFormFieldError(el);
    el.removeEventListener('input', clearHandler);
    el.removeEventListener('change', clearHandler);
  };
  el.addEventListener('input', clearHandler);
  el.addEventListener('change', clearHandler);
}
window.setFormFieldError = setFormFieldError;

function clearFormFieldError(inputElOrId, removeClasses = true) {
  const el = typeof inputElOrId === 'string' ? document.getElementById(inputElOrId) : inputElOrId;
  if (!el) return;

  if (removeClasses) {
    el.classList.remove('field-error', 'border-[#DC2626]', 'ring-1', 'ring-[#DC2626]');
  }

  if (el.parentNode) {
    const errorEl = el.parentNode.querySelector('.shared-field-error-msg');
    if (errorEl) errorEl.remove();
  }
}
window.clearFormFieldError = clearFormFieldError;

function clearAllFormErrors(containerOrModalId) {
  const container = typeof containerOrModalId === 'string' ? document.getElementById(containerOrModalId) : containerOrModalId;
  if (!container) return;
  container.querySelectorAll('.field-error, input, select, textarea').forEach(el => {
    el.classList.remove('field-error', 'border-[#DC2626]', 'ring-1', 'ring-[#DC2626]');
  });
  container.querySelectorAll('.shared-field-error-msg').forEach(el => el.remove());
}
window.clearAllFormErrors = clearAllFormErrors;

function validateSharedForm(rules) {
  let isValid = true;
  let firstInvalidEl = null;

  for (const rule of rules) {
    const el = document.getElementById(rule.id);
    if (!el) continue;

    const val = (el.value || '').trim();
    let error = null;

    if (rule.required && !val) {
      error = rule.label ? `${rule.label} is required.` : 'This field is required.';
    } else if (rule.minNumber !== undefined && (isNaN(Number(val)) || Number(val) < rule.minNumber)) {
      error = `${rule.label || 'Value'} must be at least ${rule.minNumber}.`;
    } else if (rule.minLength && val.length < rule.minLength) {
      error = `${rule.label || 'Field'} must be at least ${rule.minLength} characters.`;
    } else if (rule.customValidator && typeof rule.customValidator === 'function') {
      const customErr = rule.customValidator(val, el);
      if (customErr) error = customErr;
    }

    if (error) {
      setFormFieldError(el, error);
      isValid = false;
      if (!firstInvalidEl) firstInvalidEl = el;
    } else {
      clearFormFieldError(el);
    }
  }

  if (firstInvalidEl) {
    firstInvalidEl.focus();
    firstInvalidEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return isValid;
}
window.validateSharedForm = validateSharedForm;

// 5. Autosave & Draft Recovery for Modals
function saveFormDraft(draftKey, data) {
  try {
    localStorage.setItem('lms_draft_' + draftKey, JSON.stringify(data));
  } catch (e) {}
}

function getFormDraft(draftKey) {
  try {
    const raw = localStorage.getItem('lms_draft_' + draftKey);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearFormDraft(draftKey) {
  try {
    localStorage.removeItem('lms_draft_' + draftKey);
    const notice = document.getElementById(`${draftKey}-draft-notice`);
    if (notice) notice.remove();
  } catch (e) {}
}
window.clearFormDraft = clearFormDraft;

function initFormDraftAutoSave(modalId, draftKey, fieldIds) {
  if (Array.isArray(draftKey) && !fieldIds) {
    fieldIds = draftKey;
    draftKey = modalId;
  }
  const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
  if (!modal || !Array.isArray(fieldIds)) return;

  const saveHandler = debounce(() => {
    const data = {};
    let hasValue = false;
    fieldIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        data[id] = el.type === 'checkbox' ? el.checked : el.value;
        if (data[id]) hasValue = true;
      }
    });
    if (hasValue) {
      saveFormDraft(draftKey, data);
    }
  }, 300);

  fieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._autosaveBound) {
      el.addEventListener('input', saveHandler);
      el.addEventListener('change', saveHandler);
      el._autosaveBound = true;
    }
  });
}
window.initFormDraftAutoSave = initFormDraftAutoSave;

function restoreFormDraft(modalId, draftKey, fieldIds) {
  if (Array.isArray(draftKey) && !fieldIds) {
    fieldIds = draftKey;
    draftKey = modalId;
  }
  if (!Array.isArray(fieldIds)) return false;

  const draft = getFormDraft(draftKey);
  if (!draft) return false;

  let restoredAny = false;
  fieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el && draft[id] !== undefined && draft[id] !== '') {
      if (el.type === 'checkbox') {
        el.checked = Boolean(draft[id]);
      } else {
        el.value = draft[id];
      }
      restoredAny = true;
    }
  });

  if (restoredAny) {
    const modal = document.getElementById(modalId);
    if (modal) {
      const body = modal.querySelector('.modal-content') || modal;
      let existingNotice = document.getElementById(`${draftKey}-draft-notice`);
      if (!existingNotice) {
        existingNotice = document.createElement('div');
        existingNotice.id = `${draftKey}-draft-notice`;
        existingNotice.className = 'mx-6 mt-4 p-2.5 rounded-xl bg-[#F8F6F1] border border-[#ECEAE4] flex items-center justify-between text-xs text-[#0E4D45]';
        existingNotice.innerHTML = `
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-[#0E4D45]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span class="font-semibold text-[11px]">Restored unsaved draft</span>
          </div>
          <button type="button" onclick="discardFormDraft('${draftKey}', '${modalId}')" class="text-xs font-semibold text-[#DC2626] hover:underline cursor-pointer">
            Discard draft
          </button>
        `;
        const modalHeader = body.querySelector('.border-b') || body.firstElementChild;
        if (modalHeader && modalHeader.nextSibling) {
          body.insertBefore(existingNotice, modalHeader.nextSibling);
        }
      }
    }
  }
  return restoredAny;
}
window.restoreFormDraft = restoreFormDraft;

function discardFormDraft(draftKey, modalId) {
  clearFormDraft(draftKey);
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.querySelectorAll('input, select, textarea').forEach(el => {
      if (el.type === 'checkbox') el.checked = false;
      else if (!el.readOnly && !el.disabled) el.value = '';
    });
  }
  showToastNotification('Draft discarded');
}
window.discardFormDraft = discardFormDraft;

// 6. Graceful Error Recovery Modal
function showActionErrorModal({ title = 'Action Could Not Be Completed', message = '', errorDetails = '', retryFn = null } = {}) {
  const modal = document.getElementById('shared-error-recovery-modal');
  if (!modal) {
    showToastNotification(`Error: ${message || 'Action could not be completed.'}`);
    return;
  }

  const titleEl = document.getElementById('error-recovery-title');
  const msgEl = document.getElementById('error-recovery-message');
  const detailsEl = document.getElementById('error-recovery-details');
  const retryBtn = document.getElementById('error-recovery-retry-btn');

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message || 'A temporary error occurred while processing your request. Your typed entries have been safely preserved.';

  if (detailsEl) {
    if (errorDetails) {
      detailsEl.textContent = String(errorDetails);
      detailsEl.classList.remove('hidden');
    } else {
      detailsEl.classList.add('hidden');
    }
  }

  AppState.lastFailedAction = typeof retryFn === 'function' ? retryFn : null;
  if (retryBtn) {
    if (AppState.lastFailedAction) {
      retryBtn.classList.remove('hidden');
    } else {
      retryBtn.classList.add('hidden');
    }
  }

  modal.classList.add('active');
}
window.showActionErrorModal = showActionErrorModal;

function closeActionErrorModal() {
  const modal = document.getElementById('shared-error-recovery-modal');
  if (modal) modal.classList.remove('active');
}
window.closeActionErrorModal = closeActionErrorModal;

function retryLastFailedAction() {
  closeActionErrorModal();
  if (typeof AppState.lastFailedAction === 'function') {
    const fn = AppState.lastFailedAction;
    AppState.lastFailedAction = null;
    fn();
  }
}
window.retryLastFailedAction = retryLastFailedAction;

// 7. Shared Destructive Action Confirmation Modal
function openSharedConfirmationModal({ 
  title = 'Confirm Deletion', 
  message = 'Are you sure you want to delete this record? This action cannot be undone.', 
  confirmText = 'Delete Record', 
  cancelText = 'Cancel', 
  isDestructive = true, 
  onConfirm = null 
} = {}) {
  const modal = document.getElementById('delete-confirmation-modal');
  if (!modal) {
    if (confirm(message)) {
      if (typeof onConfirm === 'function') onConfirm();
    }
    return;
  }

  const titleEl = document.getElementById('delete-modal-title');
  const msgEl = document.getElementById('delete-modal-message');
  const confirmBtn = document.getElementById('delete-modal-confirm-btn');
  const cancelBtn = document.getElementById('delete-modal-cancel-btn');

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (cancelBtn) cancelBtn.textContent = cancelText;

  if (confirmBtn) {
    confirmBtn.textContent = confirmText;
    if (isDestructive) {
      confirmBtn.className = 'px-5 py-2.5 text-xs font-semibold rounded-xl bg-[#DC2626] hover:bg-red-700 text-white transition-colors shadow-2xs cursor-pointer';
    } else {
      confirmBtn.className = 'px-5 py-2.5 text-xs font-semibold rounded-xl bg-[#0E4D45] hover:bg-[#14534B] text-white transition-colors shadow-2xs cursor-pointer';
    }
    confirmBtn.onclick = function() {
      closeDeleteConfirmationModal();
      if (typeof onConfirm === 'function') onConfirm();
    };
  }

  modal.classList.add('active');
}
window.openSharedConfirmationModal = openSharedConfirmationModal;

// 8. Command Palette Controller (Ctrl+K / Cmd+K)
function openCommandPalette() {
  const modal = document.getElementById('shared-command-palette-modal');
  if (!modal) return;
  modal.classList.add('active');
  const input = document.getElementById('command-palette-input');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 50);
  }
  AppState.commandPaletteSelectedIndex = 0;
  renderCommandPaletteResults('');
}
window.openCommandPalette = openCommandPalette;

function closeCommandPalette() {
  const modal = document.getElementById('shared-command-palette-modal');
  if (modal) modal.classList.remove('active');
}
window.closeCommandPalette = closeCommandPalette;

function handleCommandPaletteBackdrop(event) {
  if (event.target.id === 'shared-command-palette-modal') {
    closeCommandPalette();
  }
}
window.handleCommandPaletteBackdrop = handleCommandPaletteBackdrop;

const handleCommandPaletteInput = debounce((query) => {
  AppState.commandPaletteSelectedIndex = 0;
  renderCommandPaletteResults(query);
}, 100);
window.handleCommandPaletteInput = handleCommandPaletteInput;

let _commandPaletteItems = [];

function renderCommandPaletteResults(query) {
  const container = document.getElementById('command-palette-results');
  if (!container) return;

  const q = (query || '').trim().toLowerCase();
  _commandPaletteItems = [];

  const navItems = [
    { label: 'Admin Dashboard', category: 'Navigation', icon: 'dashboard', action: () => { switchRole('admin'); setNavTab('dashboard'); } },
    { label: '12-Month Fee Ledger', category: 'Navigation', icon: 'fee', action: () => { switchRole('admin'); setNavTab('fee-matrix'); } },
    { label: 'Student Directory', category: 'Navigation', icon: 'user', action: () => { switchRole('admin'); setNavTab('students'); } },
    { label: 'Teacher Payroll', category: 'Navigation', icon: 'teacher', action: () => { switchRole('admin'); setNavTab('teachers'); } },
    { label: 'Trials & Notices', category: 'Navigation', icon: 'notice', action: () => { switchRole('admin'); setNavTab('trials-notices'); } },
    { label: 'Library', category: 'Navigation', icon: 'book', action: () => { switchRole('admin'); setNavTab('library'); } },
    { label: 'Manager Radar & Live Sessions', category: 'Navigation', icon: 'radar', action: () => { switchRole('manager'); setNavTab('manager-radar'); } },
    { label: 'Teacher Schedule & Log', category: 'Navigation', icon: 'calendar', action: () => { switchRole('teacher'); setNavTab('teacher-schedule'); } },
    { label: 'Student & Parent Portal', category: 'Navigation', icon: 'user', action: () => { switchRole('student'); setNavTab('student-portal'); } },
    { label: 'Academy Settings', category: 'Navigation', icon: 'settings', action: () => openSettingsModal() },
    { label: 'Full System Activity Log', category: 'Navigation', icon: 'log', action: () => openFullActivityLogModal() }
  ];

  const actionItems = [
    { label: 'Receive Fee (FIFO Waterfall)', category: 'Quick Action', icon: 'fee', action: () => openReceiveFeeModal() },
    { label: 'Enroll New Student (+)', category: 'Quick Action', icon: 'user', action: () => openAddStudentModal() },
    { label: 'Add New Teacher / Faculty (+)', category: 'Quick Action', icon: 'teacher', action: () => openAddTeacherModal() },
    { label: 'Schedule Student Trial Candidate', category: 'Quick Action', icon: 'calendar', action: () => openAddTrialModal() },
    { label: 'Post Academy Notice', category: 'Quick Action', icon: 'notice', action: () => openPublishNoticeModal() },
    { label: '30-Sec Sabaq / Lesson Logger', category: 'Quick Action', icon: 'log', action: () => openSabaqLoggerModal() },
    { label: 'Keyboard Shortcuts Cheatsheet', category: 'Quick Action', icon: 'shortcuts', action: () => openKeyboardShortcutsModal() }
  ];

  const studentItems = (AppState.students || []).map(s => ({
    label: `${s.firstName} ${s.lastName} (${s.id}) - ${s.course || 'Quran'}`,
    subLabel: `Teacher: ${s.teacherName || 'Unassigned'} • Guardian: ${s.guardianName || ''} (${s.phone || ''})`,
    category: 'Students',
    icon: 'user',
    avatar: s.avatar || getAvatarUrl(`${s.firstName} ${s.lastName}`),
    action: () => { switchRole('admin'); setNavTab('students'); openEditStudentModal(s.id); }
  }));

  const teacherItems = (AppState.teachers || []).map(t => {
    const activeCount = (AppState.students || []).filter(s => s.teacherId === t.id && (s.academicStatus || 'Active') === 'Active').length;
    return {
      label: `${t.name} (${t.id})`,
      subLabel: `Teacher • ${activeCount} Active Student${activeCount === 1 ? '' : 's'}`,
      category: 'Faculty',
      icon: 'teacher',
      avatar: t.avatar || getAvatarUrl(t.name),
      action: () => { switchRole('admin'); setNavTab('teachers'); }
    };
  });

  const allItems = [...actionItems, ...navItems, ...studentItems, ...teacherItems];
  const matched = q 
    ? allItems.filter(item => 
        item.label.toLowerCase().includes(q) || 
        (item.subLabel && item.subLabel.toLowerCase().includes(q)) ||
        item.category.toLowerCase().includes(q)
      )
    : [...actionItems.slice(0, 4), ...navItems.slice(0, 5), ...studentItems.slice(0, 4)];

  _commandPaletteItems = matched;

  if (matched.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center text-[#7A8684]">
        <p class="text-xs font-semibold text-[#141F1E]">No matches found for "${query}"</p>
        <p class="text-[11px] mt-1">Try searching for a student name, course, teacher, or page.</p>
      </div>
    `;
    return;
  }

  const groups = {};
  matched.forEach((item, idx) => {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push({ ...item, globalIndex: idx });
  });

  let html = '';
  Object.keys(groups).forEach(cat => {
    html += `<div class="text-[10px] font-bold text-[#7A8684] uppercase tracking-wider px-2 pt-2 pb-1">${cat}</div>`;
    groups[cat].forEach(item => {
      const isSelected = item.globalIndex === AppState.commandPaletteSelectedIndex;
      html += `
        <div 
          onclick="executeCommandPaletteItem(${item.globalIndex})" 
          class="command-palette-item p-2.5 rounded-xl flex items-center justify-between gap-3 text-xs ${isSelected ? 'selected' : 'text-[#141F1E] hover:bg-[#F8F6F1]'}"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            ${item.avatar ? `
              <img src="${item.avatar}" alt="" class="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-[#ECEAE4]" />
            ` : `
              <div class="w-6 h-6 rounded-lg bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center shrink-0">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
              </div>
            `}
            <div class="truncate">
              <div class="font-semibold text-xs leading-tight">${item.label}</div>
              ${item.subLabel ? `<div class="text-[10px] text-[#7A8684] truncate">${item.subLabel}</div>` : ''}
            </div>
          </div>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-white/80 border border-[#ECEAE4] text-[#7A8684] shrink-0 font-mono">↵</span>
        </div>
      `;
    });
  });

  container.innerHTML = html;
}
window.renderCommandPaletteResults = renderCommandPaletteResults;

function handleCommandPaletteKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (_commandPaletteItems.length > 0) {
      AppState.commandPaletteSelectedIndex = (AppState.commandPaletteSelectedIndex + 1) % _commandPaletteItems.length;
      renderCommandPaletteResults(document.getElementById('command-palette-input')?.value || '');
    }
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (_commandPaletteItems.length > 0) {
      AppState.commandPaletteSelectedIndex = (AppState.commandPaletteSelectedIndex - 1 + _commandPaletteItems.length) % _commandPaletteItems.length;
      renderCommandPaletteResults(document.getElementById('command-palette-input')?.value || '');
    }
  } else if (event.key === 'Enter') {
    event.preventDefault();
    executeCommandPaletteItem(AppState.commandPaletteSelectedIndex);
  } else if (event.key === 'Escape') {
    closeCommandPalette();
  }
}
window.handleCommandPaletteKeydown = handleCommandPaletteKeydown;

function executeCommandPaletteItem(index) {
  if (_commandPaletteItems[index] && typeof _commandPaletteItems[index].action === 'function') {
    closeCommandPalette();
    _commandPaletteItems[index].action();
  }
}
window.executeCommandPaletteItem = executeCommandPaletteItem;

function openKeyboardShortcutsModal() {
  const modal = document.getElementById('shared-keyboard-shortcuts-modal');
  if (modal) modal.classList.add('active');
}
window.openKeyboardShortcutsModal = openKeyboardShortcutsModal;

function closeKeyboardShortcutsModal() {
  const modal = document.getElementById('shared-keyboard-shortcuts-modal');
  if (modal) modal.classList.remove('active');
}
window.closeKeyboardShortcutsModal = closeKeyboardShortcutsModal;

// 9. Bulk Actions on Lists (Student Directory)
function toggleSelectAllStudents(checked) {
  if (!AppState.selectedStudentIds) AppState.selectedStudentIds = new Set();
  const filtered = getFilteredStudentsForDirectory();
  if (checked) {
    filtered.forEach(s => AppState.selectedStudentIds.add(s.id));
  } else {
    AppState.selectedStudentIds.clear();
  }
  updateBulkActionBarUI();
  document.querySelectorAll('.student-row-checkbox').forEach(cb => {
    cb.checked = checked;
  });
}
window.toggleSelectAllStudents = toggleSelectAllStudents;

function toggleSelectStudent(studentId, checked) {
  if (!AppState.selectedStudentIds) AppState.selectedStudentIds = new Set();
  if (checked) {
    AppState.selectedStudentIds.add(studentId);
  } else {
    AppState.selectedStudentIds.delete(studentId);
  }
  const selectAllCb = document.getElementById('select-all-students-cb');
  const filtered = getFilteredStudentsForDirectory();
  if (selectAllCb) {
    selectAllCb.checked = filtered.length > 0 && filtered.every(s => AppState.selectedStudentIds.has(s.id));
  }
  updateBulkActionBarUI();
}
window.toggleSelectStudent = toggleSelectStudent;

function clearSelectedStudents() {
  if (AppState.selectedStudentIds) AppState.selectedStudentIds.clear();
  const selectAllCb = document.getElementById('select-all-students-cb');
  if (selectAllCb) selectAllCb.checked = false;
  document.querySelectorAll('.student-row-checkbox').forEach(cb => cb.checked = false);
  updateBulkActionBarUI();
}
window.clearSelectedStudents = clearSelectedStudents;

function updateBulkActionBarUI() {
  let bar = document.getElementById('shared-bulk-action-bar');
  const count = AppState.selectedStudentIds ? AppState.selectedStudentIds.size : 0;

  if (count === 0) {
    if (bar) bar.remove();
    return;
  }

  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'shared-bulk-action-bar';
    bar.className = 'bulk-action-bar px-5 py-3 flex items-center gap-4 text-xs font-semibold';
    document.body.appendChild(bar);
  }

  bar.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
      <span>${count} student${count === 1 ? '' : 's'} selected</span>
    </div>
    <div class="h-4 w-px bg-[#236058]"></div>
    <div class="flex items-center gap-2">
      <button type="button" onclick="exportSelectedStudentsCSV()" class="px-3.5 py-1.5 rounded-xl bg-[#14534B] hover:bg-[#236058] text-white transition-colors flex items-center gap-1.5 cursor-pointer">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        <span>Export CSV</span>
      </button>
      <button type="button" onclick="clearSelectedStudents()" class="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-[#A3C2BE] hover:text-white transition-colors cursor-pointer">
        Clear
      </button>
    </div>
  `;
}
window.updateBulkActionBarUI = updateBulkActionBarUI;

function exportSelectedStudentsCSV() {
  if (!AppState.selectedStudentIds || AppState.selectedStudentIds.size === 0) {
    showToastNotification('No students selected for export');
    return;
  }
  const selectedList = (AppState.students || []).filter(s => AppState.selectedStudentIds.has(s.id));
  if (selectedList.length === 0) return;

  const headers = ['ID', 'First Name', 'Last Name', 'Course', 'Assigned Teacher', 'Guardian Name', 'Phone', 'Email', 'Monthly Fee', 'Currency', 'Status'];
  const rows = selectedList.map(s => [
    `"${s.id}"`,
    `"${s.firstName || ''}"`,
    `"${s.lastName || ''}"`,
    `"${s.course || ''}"`,
    `"${s.teacherName || ''}"`,
    `"${s.guardianName || ''}"`,
    `"${s.phone || ''}"`,
    `"${s.email || ''}"`,
    `"${s.monthlyFee || 0}"`,
    `"${s.currency || '$'}"`,
    `"${s.academicStatus || 'Active'}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `selected_students_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToastNotification(`✓ Exported ${selectedList.length} selected students to CSV`);
}
window.exportSelectedStudentsCSV = exportSelectedStudentsCSV;

// 10. Custom 404 Page Renderer & Route Dispatcher
function renderNotFoundView(requestedRoute) {
  return `
    <div class="max-w-xl mx-auto py-16 px-6 text-center">
      <div class="p-8 sm:p-10 bg-white rounded-2xl border border-[#ECEAE4] shadow-xs">
        <div class="w-14 h-14 rounded-2xl bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mx-auto mb-4 border border-[#ECEAE4]">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#F8F6F1] text-[#7A8684] border border-[#ECEAE4] mb-2">404 • Not Found</span>
        <h2 class="text-xl sm:text-2xl font-bold text-[#141F1E]">Page or View Not Found</h2>
        <p class="text-xs text-[#7A8684] mt-2 mb-6 leading-relaxed max-w-sm mx-auto">
          The requested route <code class="px-1.5 py-0.5 bg-[#F8F6F1] rounded text-[#0E4D45] font-mono text-[11px]">${requestedRoute || 'unknown'}</code> is unavailable or does not exist.
        </p>
        <div class="flex items-center justify-center gap-3">
          <button type="button" onclick="switchRole('admin'); setNavTab('dashboard')" class="px-5 py-2.5 rounded-full bg-[#0E4D45] hover:bg-[#14534B] text-white text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
            <span>Back to Dashboard</span>
          </button>
        </div>
      </div>
    </div>
  `;
}
window.renderNotFoundView = renderNotFoundView;

function handleRouteHash() {
  if (window.location.hash) {
    const raw = window.location.hash.replace('#/', '').replace('#', '').trim();
    const validNavs = [
      'dashboard', 'fee-matrix', 'students', 'teachers', 'trials-notices',
      'manager-radar', 'manager-trials', 'manager-substitute', 'manager-students',
      'teacher-schedule', 'teacher-logger', 'teacher-my-students',
      'student-portal', 'student-ledger', 'student-receipts', 'library'
    ];
    if (validNavs.includes(raw)) {
      if (['manager-radar', 'manager-trials', 'manager-substitute', 'manager-students'].includes(raw)) {
        AppState.currentRole = 'manager';
      } else if (['teacher-schedule', 'teacher-logger', 'teacher-my-students'].includes(raw)) {
        AppState.currentRole = 'teacher';
      } else if (['student-portal', 'student-ledger', 'student-receipts'].includes(raw)) {
        AppState.currentRole = 'student';
      } else {
        AppState.currentRole = 'admin';
      }
      AppState.activeNav = raw;
      updateRolePillUI();
      renderApp();
    } else if (raw) {
      AppState.activeNav = '404';
      const container = document.getElementById('main-dynamic-content');
      if (container) {
        container.innerHTML = renderNotFoundView(raw);
        renderNavLinks();
      }
    }
  }
}
window.addEventListener('hashchange', handleRouteHash);

// 11. Reusable Data Table Component
function renderSharedDataTable({
  id = 'shared-table',
  columns = [],
  data = [],
  renderRow = null,
  emptyState = null,
  selectable = false,
  selectedIds = null,
  onSelectAll = null,
  onSelectRow = null,
  page = 1,
  pageSize = 10,
  totalCount = 0
} = {}) {
  const actualTotal = totalCount || data.length;
  if (data.length === 0 && emptyState) {
    return emptyState;
  }

  const theadCols = columns.map(col => `
    <th class="py-3 px-2.5 ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.className || ''}">
      ${col.label}
    </th>
  `).join('');

  const rowsHtml = renderRow ? data.map((item, idx) => renderRow(item, idx)).join('') : '';

  return `
    <div class="w-full bg-white rounded-2xl border border-[#ECEAE4] overflow-hidden shadow-xs">
      <div class="overflow-x-auto min-h-[300px]">
        <table class="w-full text-left border-collapse responsive-table-cards" id="${id}">
          <thead>
            <tr class="border-b border-[#ECEAE4] text-[11px] font-semibold text-[#7A8684] bg-[#F8F6F1]/50">
              ${selectable ? `
                <th class="py-3 px-2.5 w-8">
                  <input type="checkbox" id="${id}-select-all" onchange="${onSelectAll || ''}" class="rounded border-[#ECEAE4] text-[#0E4D45] focus:ring-[#0E4D45] cursor-pointer" />
                </th>
              ` : ''}
              ${theadCols}
            </tr>
          </thead>
          <tbody class="divide-y divide-[#F1EFEA] text-xs">
            ${rowsHtml}
          </tbody>
        </table>
      </div>
      <div class="px-4 py-3 bg-[#F8F6F1] border-t border-[#ECEAE4] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#7A8684]">
        <div>
          Showing <span class="font-bold text-[#141F1E]">${Math.min(1, actualTotal)}</span> to <span class="font-bold text-[#141F1E]">${actualTotal}</span> of <span class="font-bold text-[#141F1E]">${actualTotal}</span> records
        </div>
        <div class="flex items-center gap-1">
          <span class="text-[11px] text-[#7A8684] mr-2">Page 1 of 1</span>
          <button type="button" disabled class="px-2.5 py-1 rounded-lg border border-[#ECEAE4] bg-white text-[#7A8684] opacity-50 cursor-not-allowed">‹</button>
          <button type="button" disabled class="px-2.5 py-1 rounded-lg border border-[#ECEAE4] bg-white text-[#7A8684] opacity-50 cursor-not-allowed">›</button>
        </div>
      </div>
    </div>
  `;
}
window.renderSharedDataTable = renderSharedDataTable;

// 12. Global Keyboard Shortcuts Handler
window.addEventListener('keydown', (event) => {
  // Ctrl+K / Cmd+K -> Toggle Command Palette
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    const modal = document.getElementById('shared-command-palette-modal');
    if (modal && modal.classList.contains('active')) {
      closeCommandPalette();
    } else {
      openCommandPalette();
    }
    return;
  }

  // Escape key -> Close all active modals, dropdowns, popovers
  if (event.key === 'Escape') {
    closeCommandPalette();
    closeKeyboardShortcutsModal();
    closeActionErrorModal();
    closeDeleteConfirmationModal();
    closeAddStudentModal();
    closeAddTeacherModal();
    closeEditTeacherModal();
    closeReceiveFeeModal();
    closeSettingsModal();
    closeFullActivityLogModal();
    closePublishNoticeModal();
    closeAddTrialModal();
    closeAddLiveClassModal();
    closeNotificationsDropdown();
    closeProfileDropdown();
    closeMonthYearDropdown();
    if (typeof closeFeeFilterBottomSheet === 'function') closeFeeFilterBottomSheet();
    if (AppState.activeStudentActionMenuId) {
      AppState.activeStudentActionMenuId = null;
      renderApp();
    }
    return;
  }

  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  const isInputActive = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';
  if (isInputActive) return;

  // Question mark (?) -> Open Keyboard Shortcuts
  if (event.key === '?' || (event.shiftKey && event.key === '/')) {
    event.preventDefault();
    openKeyboardShortcutsModal();
    return;
  }

  // Alt+1..5 -> Quick Tab Navigation
  if (event.altKey && event.key === '1') { event.preventDefault(); switchRole('admin'); setNavTab('dashboard'); }
  if (event.altKey && event.key === '2') { event.preventDefault(); switchRole('admin'); setNavTab('fee-matrix'); }
  if (event.altKey && event.key === '3') { event.preventDefault(); switchRole('admin'); setNavTab('students'); }
  if (event.altKey && event.key === '4') { event.preventDefault(); switchRole('admin'); setNavTab('teachers'); }
  if (event.altKey && event.key === '5') { event.preventDefault(); switchRole('admin'); setNavTab('trials-notices'); }

  // Alt+S -> Add Student
  if (event.altKey && event.key.toLowerCase() === 's') { event.preventDefault(); openAddStudentModal(); }
  // Alt+F -> Receive Fee
  if (event.altKey && event.key.toLowerCase() === 'f') { event.preventDefault(); openReceiveFeeModal(); }
});


// ==========================================
// MONTH & YEAR ACADEMIC SESSION CONTROLLER
// ==========================================

function toggleMonthYearDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('month-year-dropdown');
  if (!dropdown) return;
  const isHidden = dropdown.classList.contains('hidden');
  if (isHidden) {
    renderMonthYearDropdownContent();
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
}

function closeMonthYearDropdown() {
  const dropdown = document.getElementById('month-year-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
}

function renderMonthYearDropdownContent() {
  const container = document.getElementById('dropdown-months-grid');
  const yearSelect = document.getElementById('select-active-year');

  if (yearSelect) {
    // Populate options from 2020 to 2050 dynamically if needed
    if (yearSelect.options.length < 25) {
      yearSelect.innerHTML = '';
      for (let y = 2020; y <= 2050; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (y === CURRENT_YEAR) opt.selected = true;
        yearSelect.appendChild(opt);
      }
    }
    yearSelect.value = CURRENT_YEAR.toString();
  }

  if (!container) return;

  container.innerHTML = MONTHS_LIST.map((m, idx) => {
    const isCurrent = idx === CURRENT_MONTH_INDEX;
    const btnClass = isCurrent
      ? 'bg-[#0E4D45] text-white font-bold shadow-sm ring-2 ring-[#0E4D45]'
      : 'bg-[#F8F6F1] text-[#141F1E] hover:bg-[#E8EFEE] font-medium';
    return `
      <button type="button" onclick="setAcademyMonthYear(${idx}, ${CURRENT_YEAR})" 
        class="py-2 px-1 rounded-xl text-center text-xs transition-all ${btnClass}">
        ${m}
      </button>
    `;
  }).join('');
}

function updateHeaderDateDisplay() {
  const heroText = document.getElementById('hero-date-text');
  if (heroText) {
    const fullMonth = FULL_MONTHS_LIST[CURRENT_MONTH_INDEX] || MONTHS_LIST[CURRENT_MONTH_INDEX];
    heroText.textContent = `${fullMonth} ${CURRENT_YEAR}`;
  }
}
window.updateHeaderDateDisplay = updateHeaderDateDisplay;

function stepYear(delta) {
  let targetYear = (CURRENT_YEAR || _systemCurrentDate.getFullYear()) + delta;
  if (targetYear < 2020) targetYear = 2020;
  if (targetYear > 2050) targetYear = 2050;

  CURRENT_YEAR = targetYear;
  AppState.currentYear = CURRENT_YEAR;

  const yearSelect = document.getElementById('select-active-year');
  if (yearSelect) {
    yearSelect.value = CURRENT_YEAR.toString();
  }

  // Update hero date text
  updateHeaderDateDisplay();

  renderMonthYearDropdownContent();
  renderApp();
  showToastNotification(`✓ Academic Year switched to ${CURRENT_YEAR}`);
}

function changeYearSelection(year) {
  CURRENT_YEAR = Number(year);
  AppState.currentYear = CURRENT_YEAR;

  // Update hero date text
  updateHeaderDateDisplay();

  renderMonthYearDropdownContent();
  renderApp();
  showToastNotification(`✓ Academic Year set to ${CURRENT_YEAR}`);
}

function setAcademyMonthYear(monthIndex, year) {
  CURRENT_MONTH_INDEX = Number(monthIndex);
  CURRENT_YEAR = Number(year);
  AppState.currentMonthIndex = CURRENT_MONTH_INDEX;
  AppState.currentYear = CURRENT_YEAR;

  // Update hero date text
  updateHeaderDateDisplay();

  closeMonthYearDropdown();
  renderApp();
  showToastNotification(`✓ Active Academic Period switched to ${FULL_MONTHS_LIST[CURRENT_MONTH_INDEX]} ${CURRENT_YEAR}`);
}

function stepAcademicMonth(delta) {
  let newMonth = CURRENT_MONTH_INDEX + delta;
  let newYear = CURRENT_YEAR;
  if (newMonth < 0) {
    newMonth = 11;
    newYear -= 1;
  } else if (newMonth > 11) {
    newMonth = 0;
    newYear += 1;
  }
  setAcademyMonthYear(newMonth, newYear);
}

// Global click listener to close popover & dropdowns
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('month-year-dropdown');
  const trigger = document.getElementById('hero-date-pill');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    if (!dropdown.contains(e.target) && (!trigger || !trigger.contains(e.target))) {
      dropdown.classList.add('hidden');
    }
  }

  // Profile & portal switcher dropdown
  const profileDropdown = document.getElementById('profile-dropdown-menu');
  const profileContainer = document.getElementById('profile-dropdown-container');
  if (profileDropdown && !profileDropdown.classList.contains('hidden')) {
    if (!profileContainer || !profileContainer.contains(e.target)) {
      profileDropdown.classList.add('hidden');
    }
  }

  // Header notifications dropdown
  const notifDropdown = document.getElementById('notifications-dropdown-menu');
  const notifContainer = document.getElementById('notifications-dropdown-container');
  if (notifDropdown && !notifDropdown.classList.contains('hidden')) {
    if (!notifContainer || !notifContainer.contains(e.target)) {
      notifDropdown.classList.add('hidden');
    }
  }

  // Live Class Monitoring filter popover
  const liveClassPopover = document.getElementById('live-class-filter-popover');
  const liveClassContainer = document.getElementById('live-class-filter-container');
  if (liveClassPopover && !liveClassPopover.classList.contains('hidden')) {
    if (!liveClassContainer || !liveClassContainer.contains(e.target)) {
      liveClassPopover.classList.add('hidden');
      if (typeof AppState !== 'undefined') AppState.liveClassFilterOpen = false;
    }
  }

  // Close any modal when dark backdrop is clicked directly
  if (e.target && e.target.classList && e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('active');
  }
});

// ==========================================
// 7-DAY TIMETABLE & DUAL TIMEZONE ENGINE (3-IN-1 UNIFIED)
// ==========================================

const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const WEEK_DAY_LABELS = {
  mon: { short: 'Mon', full: 'Monday' },
  tue: { short: 'Tue', full: 'Tuesday' },
  wed: { short: 'Wed', full: 'Wednesday' },
  thu: { short: 'Thu', full: 'Thursday' },
  fri: { short: 'Fri', full: 'Friday' },
  sat: { short: 'Sat', full: 'Saturday' },
  sun: { short: 'Sun', full: 'Sunday' }
};

function parseTimezoneOffset(tzStr) {
  if (!tzStr) return 5;
  const match = tzStr.match(/GMT([+-]\d+)/i) || tzStr.match(/UTC([+-]\d+)/i);
  if (match) return parseInt(match[1], 10);
  if (tzStr.includes('BST')) return 1;
  if (tzStr.includes('EDT')) return -4;
  if (tzStr.includes('EST') || tzStr.includes('CDT')) return -5;
  if (tzStr.includes('CST')) return -6;
  if (tzStr.includes('PDT')) return -7;
  if (tzStr.includes('PST')) return -8;
  if (tzStr.includes('GST')) return 4;
  if (tzStr.includes('CEST') || tzStr.includes('CEDT')) return 2;
  if (tzStr.includes('CET')) return 1;
  if (tzStr.includes('AEST')) return 10;
  if (tzStr.includes('PKT')) return 5;
  if (tzStr.includes('AST')) return 3;
  return 5;
}

function getTimezoneDiffLabel(studentTzStr) {
  const studentOffset = parseTimezoneOffset(studentTzStr);
  const teacherOffset = 5; // PKT baseline is GMT+5
  const diff = teacherOffset - studentOffset;
  if (diff === 0) return 'Same Time as Pakistan (PKT)';
  if (diff > 0) return `PKT is +${diff}h ahead`;
  return `PKT is ${Math.abs(diff)}h behind`;
}

function convertStudentTimeToPkt(timeStr, studentTzStr) {
  if (!timeStr || !timeStr.trim()) return '';
  const studentOffset = parseTimezoneOffset(studentTzStr);
  const teacherOffset = 5; // PKT baseline
  const diffHours = teacherOffset - studentOffset;

  function convertSingleTime(tStr) {
    const clean = tStr.trim();
    const match = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!match) return clean;
    let hour = parseInt(match[1], 10);
    const minute = match[2];
    const ampm = (match[3] || '').toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    let totalMinutes = hour * 60 + parseInt(minute, 10) + diffHours * 60;
    let dayShift = 0;
    while (totalMinutes >= 24 * 60) {
      totalMinutes -= 24 * 60;
      dayShift += 1;
    }
    while (totalMinutes < 0) {
      totalMinutes += 24 * 60;
      dayShift -= 1;
    }

    const newHour24 = Math.floor(totalMinutes / 60);
    const newMinute = String(totalMinutes % 60).padStart(2, '0');
    const newAmpm = newHour24 >= 12 ? 'PM' : 'AM';
    const newHour12 = newHour24 % 12 === 0 ? 12 : newHour24 % 12;
    const shiftText = dayShift > 0 ? ` (+${dayShift}d)` : dayShift < 0 ? ` (${dayShift}d)` : '';
    return `${String(newHour12).padStart(2, '0')}:${newMinute} ${newAmpm}${shiftText}`;
  }

  if (timeStr.includes('-')) {
    const parts = timeStr.split('-');
    const startPkt = convertSingleTime(parts[0]);
    const endPkt = convertSingleTime(parts[1]);
    return `${startPkt} - ${endPkt} PKT`;
  }
  return `${convertSingleTime(timeStr)} PKT`;
}

function calculateEndTimeString(startTime, duration = '45m') {
  if (!startTime) return '';
  const match = startTime.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return startTime;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampm = (match[3] || 'AM').toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  
  const durMinutes = parseInt(duration, 10) || 45;
  const totalM = h * 60 + m + durMinutes;
  
  let newH = Math.floor(totalM / 60) % 24;
  const newM = totalM % 60;
  const newAmpm = newH >= 12 ? 'PM' : 'AM';
  let newH12 = newH % 12;
  if (newH12 === 0) newH12 = 12;
  return `${String(newH12).padStart(2, '0')}:${String(newM).padStart(2, '0')} ${newAmpm}`;
}

function getStudentWeeklySchedule(student) {
  const fallback = {
    mon: { active: true, time: '10:00 AM - 10:45 AM' },
    tue: { active: false, time: '' },
    wed: { active: true, time: '10:00 AM - 10:45 AM' },
    thu: { active: false, time: '' },
    fri: { active: true, time: '10:00 AM - 10:45 AM' },
    sat: { active: false, time: '' },
    sun: { active: false, time: '' }
  };

  if (!student || !student.weeklySchedule) {
    return fallback;
  }

  // If array format: [ { day: 'Mon', time: '11:00 AM', duration: '45m' } ]
  if (Array.isArray(student.weeklySchedule)) {
    const obj = {
      mon: { active: false, time: '' },
      tue: { active: false, time: '' },
      wed: { active: false, time: '' },
      thu: { active: false, time: '' },
      fri: { active: false, time: '' },
      sat: { active: false, time: '' },
      sun: { active: false, time: '' }
    };
    student.weeklySchedule.forEach(slot => {
      if (!slot || !slot.day) return;
      const key = slot.day.toLowerCase().slice(0, 3);
      if (obj[key] !== undefined) {
        let timeStr = slot.time || '';
        if (timeStr && !timeStr.includes('-')) {
          timeStr = `${timeStr} - ${calculateEndTimeString(timeStr, slot.duration || '45m')}`;
        }
        obj[key] = { active: true, time: timeStr, duration: slot.duration || '45m' };
      }
    });
    return obj;
  }

  // If already object format
  if (typeof student.weeklySchedule === 'object') {
    return student.weeklySchedule;
  }

  return fallback;
}

function getStudentScheduleSlots(student) {
  if (!student) return [];
  
  if (Array.isArray(student.weeklySchedule)) {
    return student.weeklySchedule.map(slot => {
      let timeStr = slot.time || '';
      let timeRange = timeStr;
      if (!timeRange.includes('-') && timeRange) {
        timeRange = `${timeStr} - ${calculateEndTimeString(timeStr, slot.duration || '45m')}`;
      }
      const pktRaw = convertStudentTimeToPkt(timeRange, student.timezone || 'GMT-5 (CST)');
      const pktStart = pktRaw.includes('-') ? pktRaw.split('-')[0].trim() + ' PKT' : (pktRaw || 'PKT');
      return {
        day: slot.day,
        time: slot.time,
        duration: slot.duration || '45m',
        timeRange: timeRange,
        pktTime: pktStart
      };
    });
  }

  const sched = getStudentWeeklySchedule(student);
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayLabels = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const slots = [];
  days.forEach(d => {
    if (sched[d] && sched[d].active && sched[d].time) {
      const timeRange = sched[d].time;
      const startTime = timeRange.includes('-') ? timeRange.split('-')[0].trim() : timeRange;
      const pktRaw = convertStudentTimeToPkt(timeRange, student.timezone || 'GMT-5 (CST)');
      const pktStart = pktRaw.includes('-') ? pktRaw.split('-')[0].trim() + ' PKT' : (pktRaw || 'PKT');
      slots.push({
        day: dayLabels[d],
        time: startTime,
        duration: sched[d].duration || '45m',
        timeRange: timeRange,
        pktTime: pktStart
      });
    }
  });
  return slots;
}

function getSchedulePillSummary(student) {
  const sched = getStudentWeeklySchedule(student);
  const activeDays = WEEK_DAYS.filter(d => sched[d] && sched[d].active);
  const count = activeDays.length;
  if (count === 0) return 'No Active Days';

  const firstTime = sched[activeDays[0]].time;
  const sameTime = activeDays.every(d => sched[d].time === firstTime);
  const dayNamesShort = activeDays.map(d => WEEK_DAY_LABELS[d].short).join(', ');

  if (sameTime && count >= 2) {
    return `${dayNamesShort} • ${firstTime}`;
  }
  return `${count} Days/wk (Variable Times)`;
}

function calculateWeeklyMetrics(weeklySchedule) {
  let activeCount = 0;
  let totalMinutes = 0;
  WEEK_DAYS.forEach(d => {
    if (weeklySchedule && weeklySchedule[d] && weeklySchedule[d].active) {
      activeCount++;
      const timeStr = weeklySchedule[d].time || '';
      if (timeStr.includes('-')) {
        const parts = timeStr.split('-');
        const p1 = parts[0].trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
        const p2 = parts[1].trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
        if (p1 && p2) {
          let h1 = parseInt(p1[1], 10);
          if ((p1[3] || '').toUpperCase() === 'PM' && h1 < 12) h1 += 12;
          if ((p1[3] || '').toUpperCase() === 'AM' && h1 === 12) h1 = 0;
          let m1 = h1 * 60 + parseInt(p1[2], 10);

          let h2 = parseInt(p2[1], 10);
          if ((p2[3] || '').toUpperCase() === 'PM' && h2 < 12) h2 += 12;
          if ((p2[3] || '').toUpperCase() === 'AM' && h2 === 12) h2 = 0;
          let m2 = h2 * 60 + parseInt(p2[2], 10);
          if (m2 > m1) {
            totalMinutes += (m2 - m1);
          } else {
            totalMinutes += 45;
          }
        } else {
          totalMinutes += 45;
        }
      } else {
        totalMinutes += 45;
      }
    }
  });

  const hours = (totalMinutes / 60).toFixed(1);
  return { activeCount, totalMinutes, hours };
}

// ==========================================
// MATRIX EDITOR CONTROLLERS (PRESETS & SLOTS)
// ==========================================

function renderWeeklyMatrixEditor(containerId, scheduleData, studentTz) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const tz = studentTz || 'GMT+1 (BST)';

  container.innerHTML = `
    <!-- Quick Preset Buttons -->
    <div class="flex flex-wrap items-center gap-1.5 p-2 bg-[#F8F6F1]/50 rounded-xl border border-[#E5E7EB] mb-2.5">
      <span class="text-[10px] font-bold uppercase text-[#7A8684] mr-1">Presets:</span>
      <button type="button" onclick="applySchedulePreset('${containerId}', 'mon-thu', '${tz}')" class="px-2.5 py-1 text-[11px] font-semibold rounded-full bg-white border border-[#CBD5E1] text-[#0E4D45] hover:bg-[#0E4D45] hover:text-white transition-all cursor-pointer">Mon–Thu (4d)</button>
      <button type="button" onclick="applySchedulePreset('${containerId}', 'mon-wed-fri', '${tz}')" class="px-2.5 py-1 text-[11px] font-semibold rounded-full bg-white border border-[#CBD5E1] text-[#0E4D45] hover:bg-[#0E4D45] hover:text-white transition-all cursor-pointer">Mon, Wed, Fri (3d)</button>
      <button type="button" onclick="applySchedulePreset('${containerId}', 'weekend', '${tz}')" class="px-2.5 py-1 text-[11px] font-semibold rounded-full bg-white border border-[#CBD5E1] text-[#0E4D45] hover:bg-[#0E4D45] hover:text-white transition-all cursor-pointer">Weekend (Sat–Sun)</button>
      <button type="button" onclick="applySchedulePreset('${containerId}', 'daily', '${tz}')" class="px-2.5 py-1 text-[11px] font-semibold rounded-full bg-white border border-[#CBD5E1] text-[#0E4D45] hover:bg-[#0E4D45] hover:text-white transition-all cursor-pointer">Daily (Mon–Fri)</button>
      <button type="button" onclick="copyFirstDayTimeToAll('${containerId}', '${tz}')" class="w-7 h-7 rounded-full bg-[#E8EFEE] hover:bg-[#0E4D45] text-[#0E4D45] hover:text-white border border-[#CBD5E1] transition-all flex items-center justify-center cursor-pointer sm:ml-auto shadow-2xs" title="Copy Monday time to all active days">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      </button>
    </div>

    <!-- 7 Day Rows Matrix (Minimalist Apple/Stripe Stack) -->
    <div class="space-y-1.5" id="${containerId}-rows">
      ${WEEK_DAYS.map(dayKey => {
        const day = (scheduleData && scheduleData[dayKey]) || { active: false, time: '' };
        const label = WEEK_DAY_LABELS[dayKey];
        const defaultTime = day.time || '10:00 AM - 10:45 AM';

        return `
          <div id="${containerId}-row-${dayKey}" class="px-3.5 py-2 rounded-xl border transition-all ${day.active ? 'bg-white border-[#E5E7EB]' : 'bg-[#F9FAFB] border-[#F1F3F5]'} flex items-center justify-between gap-3">
            <!-- Day Checkbox & Name -->
            <div class="flex items-center gap-2.5 w-36 shrink-0">
              <input type="checkbox" id="${containerId}-chk-${dayKey}" ${day.active ? 'checked' : ''} onchange="toggleMatrixDay('${containerId}', '${dayKey}', '${tz}')" class="w-4 h-4 rounded text-[#0E4D45] focus:ring-[#0E4D45] cursor-pointer accent-[#0E4D45]">
              <label for="${containerId}-chk-${dayKey}" class="font-semibold text-xs ${day.active ? 'text-[#141F1E]' : 'text-[#94A3B8]'} cursor-pointer select-none">
                ${label.full}
              </label>
            </div>

            <!-- Single Clean Time Input on Right with Locked PKT Hint / Off Day State -->
            <div class="flex-1 flex items-center justify-end gap-2">
              <div id="${containerId}-time-wrap-${dayKey}" class="relative w-full max-w-[280px] flex items-center ${!day.active ? 'hidden' : ''}">
                <input 
                  type="text" 
                  id="${containerId}-time-${dayKey}" 
                  value="${day.active ? defaultTime : ''}" 
                  placeholder="10:00 AM - 10:45 AM (PKT)" 
                  ${!day.active ? 'disabled' : ''} 
                  class="w-full bg-white border border-[#E5E7EB] rounded-xl pl-3 pr-14 py-1.5 text-xs text-[#141F1E] font-medium outline-none transition-all focus:border-[#0E4D45] focus:ring-1 focus:ring-[#0E4D45]"
                >
                <span class="absolute right-2 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider bg-[#F8F6F1] border border-[#ECEAE4] text-[#0E4D45] pointer-events-none select-none">
                  PKT
                </span>
              </div>
              <span id="${containerId}-off-${dayKey}" class="text-xs text-[#94A3B8] font-medium pr-2 ${day.active ? 'hidden' : ''}">Off Day</span>
              <span id="${containerId}-pkt-${dayKey}" class="hidden"></span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function toggleMatrixDay(containerId, dayKey, tz) {
  const chk = document.getElementById(`${containerId}-chk-${dayKey}`);
  const input = document.getElementById(`${containerId}-time-${dayKey}`);
  const row = document.getElementById(`${containerId}-row-${dayKey}`);
  const offSpan = document.getElementById(`${containerId}-off-${dayKey}`);
  const wrap = document.getElementById(`${containerId}-time-wrap-${dayKey}`);
  if (!chk || !input || !row) return;

  const isActive = chk.checked;
  input.disabled = !isActive;

  const label = row.querySelector('label');

  if (isActive) {
    if (!input.value.trim()) {
      input.value = '10:00 AM - 10:45 AM';
    }
    input.classList.remove('hidden');
    if (wrap) wrap.classList.remove('hidden');
    if (offSpan) offSpan.classList.add('hidden');
    row.classList.remove('bg-[#F9FAFB]', 'border-[#F1F3F5]');
    row.classList.add('bg-white', 'border-[#E5E7EB]');
    if (label) {
      label.classList.remove('text-[#94A3B8]');
      label.classList.add('text-[#141F1E]');
    }
  } else {
    input.classList.add('hidden');
    if (wrap) wrap.classList.add('hidden');
    if (offSpan) offSpan.classList.remove('hidden');
    row.classList.remove('bg-white', 'border-[#E5E7EB]');
    row.classList.add('bg-[#F9FAFB]', 'border-[#F1F3F5]');
    if (label) {
      label.classList.add('text-[#94A3B8]');
      label.classList.remove('text-[#141F1E]');
    }
  }
}

function updateMatrixRowPkt(containerId, dayKey, tz) {
  // Retained safely for script compatibility; live PKT conversion pill removed per minimalist specification
}

function applySchedulePreset(containerId, presetType, tz) {
  let activeDays = [];
  let defaultTime = '10:00 AM - 10:45 AM';

  if (presetType === 'mon-thu') activeDays = ['mon', 'tue', 'wed', 'thu'];
  else if (presetType === 'mon-wed-fri') activeDays = ['mon', 'wed', 'fri'];
  else if (presetType === 'tue-thu-sat') activeDays = ['tue', 'thu', 'sat'];
  else if (presetType === 'weekend') {
    activeDays = ['sat', 'sun'];
    defaultTime = '09:00 AM - 10:00 AM';
  } else if (presetType === 'daily') activeDays = ['mon', 'tue', 'wed', 'thu', 'fri'];

  WEEK_DAYS.forEach(dayKey => {
    const chk = document.getElementById(`${containerId}-chk-${dayKey}`);
    const input = document.getElementById(`${containerId}-time-${dayKey}`);
    if (chk && input) {
      const shouldBeActive = activeDays.includes(dayKey);
      chk.checked = shouldBeActive;
      if (shouldBeActive && !input.value.trim()) {
        input.value = defaultTime;
      }
      toggleMatrixDay(containerId, dayKey, tz);
    }
  });
}

function copyFirstDayTimeToAll(containerId, tz) {
  const monInput = document.getElementById(`${containerId}-time-mon`);
  let sourceTime = monInput && monInput.value.trim() ? monInput.value.trim() : '10:00 AM - 10:45 AM';

  WEEK_DAYS.forEach(dayKey => {
    const chk = document.getElementById(`${containerId}-chk-${dayKey}`);
    const input = document.getElementById(`${containerId}-time-${dayKey}`);
    if (chk && chk.checked && input) {
      input.value = sourceTime;
      updateMatrixRowPkt(containerId, dayKey, tz);
    }
  });
  showToastNotification(`✓ Copied time "${sourceTime}" to all active days!`);
}

function getMatrixScheduleData(containerId) {
  const result = {};
  WEEK_DAYS.forEach(dayKey => {
    const chk = document.getElementById(`${containerId}-chk-${dayKey}`);
    const input = document.getElementById(`${containerId}-time-${dayKey}`);
    const active = !!(chk && chk.checked);
    const time = active && input ? input.value.trim() : '';
    result[dayKey] = { active, time };
  });
  return result;
}

// ==========================================
// MODAL CONTROLLERS (VIEW & EDIT SCHEDULE)
// ==========================================

let currentViewingStudentId = null;

function openViewWeeklyScheduleModal(studentId) {
  const modal = document.getElementById('view-weekly-schedule-modal');
  const body = document.getElementById('view-weekly-schedule-body');
  if (!modal || !body) return;

  const student = AppState.students.find(s => s.id === studentId);
  if (!student) return;

  currentViewingStudentId = student.id;
  const teacher = (AppState.teachers || []).find(t => 
    t.id === student.teacherId || 
    (t.id && student.teacherId && t.id.toLowerCase() === student.teacherId.toLowerCase()) ||
    t.name === student.teacherName ||
    t.name === student.assignedTeacher
  ) || { id: '', name: 'Unassigned', specialization: 'None', country: 'Global', avatar: '' };
  const sched = getStudentWeeklySchedule(student);
  const metrics = calculateWeeklyMetrics(sched);
  const tzDiff = getTimezoneDiffLabel(student.timezone);

  const dayIndexMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const todayKey = dayIndexMap[new Date().getDay()];

  body.innerHTML = `
    <!-- Top Hero Banner -->
    <div class="p-4 bg-[#FFFFFF] rounded-2xl border border-[#ECEAE4] shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <img 
          src="${student.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=faces'}" 
          alt="${student.firstName}" 
          class="w-12 h-12 rounded-full object-cover shrink-0 ring-2 ring-[#0E4D45]/20 shadow-xs" 
          onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(student.firstName + ' ' + student.lastName)}&background=0E4D45&color=fff';" 
        />
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="text-base font-bold text-[#141F1E]">${student.firstName} ${student.lastName}</h3>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E8EFEE] text-[#0E4D45]">${student.id}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white text-[#7A8684] border border-[#CBD5E1]">${student.familyId}</span>
            ${renderStudentStatusPill(student.academicStatus)}
          </div>
          <p class="text-xs text-[#7A8684] mt-0.5">
            ${student.course} • <span class="font-semibold text-[#141F1E]">${student.country} (${student.timezone})</span>
          </p>
        </div>
      </div>

      <div class="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <div class="p-2.5 rounded-xl bg-[#F8F6F1] border border-[#ECEAE4] text-right">
          <span class="text-[10px] text-[#7A8684] block font-semibold">Assigned Qari / Faculty</span>
          <span class="font-bold text-xs text-[#0E4D45]">${teacher.name}</span>
          <span class="text-[10px] text-[#7A8684] block font-medium">Pakistan (PKT GMT+5)</span>
        </div>
      </div>
    </div>

    <!-- Guardian PII & Residential Contact Details Card -->
    <div class="p-3.5 bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4] grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div>
        <span class="text-[10px] text-[#7A8684] block font-semibold">Guardian / Sponsor</span>
        <span class="font-bold text-xs text-[#141F1E]">${student.guardianName || '—'}</span>
        <span class="text-[11px] text-[#7A8684] block truncate">${student.email || '—'}</span>
      </div>
      <div>
        <span class="text-[10px] text-[#7A8684] block font-semibold">Phone & WhatsApp</span>
        <div class="flex items-center gap-1.5 font-bold text-xs text-[#141F1E] mt-0.5">
          <span>${student.phone}</span>
          <a href="https://wa.me/${student.whatsapp || student.phone.replace(/[^0-9]/g, '')}" target="_blank" class="text-[11px] text-[#0E4D45] hover:underline font-bold" title="Open WhatsApp">
            WhatsApp
          </a>
        </div>
      </div>
      <div>
        <span class="text-[10px] text-[#7A8684] block font-semibold">Residential Street Address</span>
        <span class="text-xs text-[#141F1E] font-medium block truncate" title="${student.address || ''}">${student.address || 'Address on record'}</span>
      </div>
    </div>

    <!-- Dual Timezone Synchronization Indicator -->
    <div class="p-3 bg-[#E8EFEE] rounded-xl border border-[#CBD5E1] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-[#0E4D45] animate-pulse"></span>
        <span class="font-bold text-[#0E4D45]">Dual Timezone Live Bridge:</span>
        <span class="text-[#334E4B]">Student Local (${student.timezone}) ⇄ Teacher PKT (Pakistan GMT+5)</span>
      </div>
      <span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-white text-[#0E4D45] border border-[#CBD5E1] shadow-2xs">
        ${tzDiff}
      </span>
    </div>

    <!-- 7-Day Day-by-Day Schedule Table Card -->
    <div class="rounded-2xl border border-[#ECEAE4] overflow-hidden bg-white shadow-2xs">
      <table class="w-full text-left border-collapse responsive-table-cards">
        <thead>
          <tr class="bg-[#F8F6F1] border-b border-[#ECEAE4] text-[11px] font-bold text-[#7A8684] uppercase tracking-wider">
            <th class="py-3 px-4">Day of Week</th>
            <th class="py-3 px-3">Class Status</th>
            <th class="py-3 px-3">Student Local Time (${student.timezone.split(' ')[0]})</th>
            <th class="py-3 px-3">Teacher Pakistan Time (PKT)</th>
            <th class="py-3 px-4 text-right">Duration</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[#ECEAE4] text-xs">
          ${WEEK_DAYS.map(dayKey => {
            const day = sched[dayKey] || { active: false, time: '' };
            const isToday = dayKey === todayKey;
            const label = WEEK_DAY_LABELS[dayKey];
            const pktTime = day.active ? convertStudentTimeToPkt(day.time, student.timezone) : '—';

            return `
              <tr class="${isToday ? 'bg-[#E8EFEE]/60 font-semibold' : 'hover:bg-[#F8F6F1]/50'} transition-colors">
                <td class="py-3 px-4" data-label="Day of Week">
                  <div class="flex items-center gap-2">
                    <span class="font-bold ${isToday ? 'text-[#0E4D45]' : 'text-[#141F1E]'}">${label.full}</span>
                    ${isToday ? `<span class="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-[#0E4D45] text-white uppercase tracking-wider">Today</span>` : ''}
                  </div>
                </td>
                <td class="py-3 px-3" data-label="Class Status">
                  ${day.active ? `
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#D1FAE5] text-[#065F46] font-bold text-[10px] border border-[#A7F3D0]">
                      <svg class="w-3 h-3 text-[#065F46]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                      Class Active
                    </span>
                  ` : `
                    <span class="text-[10px] font-medium text-[#94A3B8] px-2 py-0.5 rounded-full bg-[#F1F4F3]">Off Day (No Class)</span>
                  `}
                </td>
                <td class="py-3 px-3 font-medium text-[#141F1E]" data-label="Student Time">
                  ${day.active ? `
                    <div class="inline-flex items-center gap-1.5 font-bold text-[#141F1E]">
                      <svg class="w-3.5 h-3.5 text-[#0E4D45]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      <span>${day.time}</span>
                    </div>
                  ` : `<span class="text-[#94A3B8]">—</span>`}
                </td>
                <td class="py-3 px-3" data-label="Pakistan Time">
                  ${day.active ? `
                    <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#E8EFEE] text-[#0E4D45] font-semibold text-[11px] border border-[#CBD5E1]">
                      <span class="text-[10px] text-[#7A8684]">PKT</span>
                      <span>${pktTime}</span>
                    </span>
                  ` : `<span class="text-[#94A3B8]">—</span>`}
                </td>
                <td class="py-3 px-4 text-right font-medium text-[#7A8684]" data-label="Duration">
                  ${day.active ? '45 mins' : '—'}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- Weekly Summary KPI Pills -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div class="p-3 bg-[#FFFFFF] rounded-xl border border-[#ECEAE4] flex items-center justify-between">
        <span class="text-xs text-[#7A8684] font-medium">Weekly Classes</span>
        <span class="text-sm font-bold text-[#0E4D45]">${metrics.activeCount} Days / week</span>
      </div>
      <div class="p-3 bg-[#FFFFFF] rounded-xl border border-[#ECEAE4] flex items-center justify-between">
        <span class="text-xs text-[#7A8684] font-medium">Weekly Contact Time</span>
        <span class="text-sm font-bold text-[#141F1E]">${metrics.hours} Hours / week</span>
      </div>
      <div class="p-3 bg-[#FFFFFF] rounded-xl border border-[#ECEAE4] flex items-center justify-between">
        <span class="text-xs text-[#7A8684] font-medium">Tuition Rate</span>
        <span class="text-sm font-bold text-[#0E4D45]">${studentFeePKRHtml(student)}/month</span>
      </div>
    </div>
  `;

  modal.classList.add('active');
}

function closeViewWeeklyScheduleModal() {
  const modal = document.getElementById('view-weekly-schedule-modal');
  if (modal) modal.classList.remove('active');
}

function openEditScheduleFromView() {
  const studentId = currentViewingStudentId;
  closeViewWeeklyScheduleModal();
  if (studentId) {
    openEditScheduleModal(studentId);
  }
}

function copyWeeklyScheduleToClipboard() {
  const student = AppState.students.find(s => s.id === currentViewingStudentId);
  if (!student) return;
  const teacher = (AppState.teachers || []).find(t => 
    t.id === student.teacherId || 
    (t.id && student.teacherId && t.id.toLowerCase() === student.teacherId.toLowerCase()) ||
    t.name === student.teacherName ||
    t.name === student.assignedTeacher
  ) || { id: '', name: 'Unassigned', specialization: 'None', country: 'Global', avatar: '' };
  const sched = getStudentWeeklySchedule(student);

  let text = `==============================\n`;
  text += `QURANIC SKILLS LMS - WEEKLY TIMETABLE\n`;
  text += `==============================\n`;
  text += `Student: ${student.firstName} ${student.lastName} (${student.id})\n`;
  text += `Course: ${student.course}\n`;
  text += `Assigned Teacher: ${teacher.name} (PKT GMT+5)\n`;
  text += `Student Timezone: ${student.country} • ${student.timezone}\n`;
  text += `Time Difference: ${getTimezoneDiffLabel(student.timezone)}\n\n`;
  text += `WEEKLY CLASS SLOTS:\n`;

  WEEK_DAYS.forEach(dayKey => {
    const day = sched[dayKey];
    const label = WEEK_DAY_LABELS[dayKey].full;
    if (day && day.active) {
      const pkt = convertStudentTimeToPkt(day.time, student.timezone);
      text += `• ${label}: ${day.time} ${student.timezone.split(' ')[0]} ⇄ PKT: ${pkt}\n`;
    } else {
      text += `• ${label}: Off Day\n`;
    }
  });

  text += `==============================\n`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToastNotification(`✓ Full weekly schedule copied to clipboard!`);
    }).catch(() => {
      showToastNotification(`✓ Timetable ready to share!`);
    });
  } else {
    showToastNotification(`✓ Timetable ready to share!`);
  }
}

const WORLD_COUNTRIES = [
  // ⭐ Top Academy Regions
  { group: 'Top Academy Regions', name: 'United Kingdom (UK)', code: 'UK', tz: 'GMT+1 (BST)' },
  { group: 'Top Academy Regions', name: 'United States (USA)', code: 'USA', tz: 'GMT-5 (CST)' },
  { group: 'Top Academy Regions', name: 'Canada', code: 'Canada', tz: 'GMT-4 (EDT)' },
  { group: 'Top Academy Regions', name: 'United Arab Emirates (UAE)', code: 'UAE', tz: 'GMT+4 (GST)' },
  { group: 'Top Academy Regions', name: 'Saudi Arabia', code: 'Saudi Arabia', tz: 'GMT+3 (AST)' },
  { group: 'Top Academy Regions', name: 'Qatar', code: 'Qatar', tz: 'GMT+3 (AST)' },
  { group: 'Top Academy Regions', name: 'Kuwait', code: 'Kuwait', tz: 'GMT+3 (AST)' },
  { group: 'Top Academy Regions', name: 'Oman', code: 'Oman', tz: 'GMT+4 (GST)' },
  { group: 'Top Academy Regions', name: 'Bahrain', code: 'Bahrain', tz: 'GMT+3 (AST)' },
  { group: 'Top Academy Regions', name: 'Pakistan', code: 'Pakistan', tz: 'GMT+5 (PKT)' },
  { group: 'Top Academy Regions', name: 'Australia', code: 'Australia', tz: 'GMT+10 (AEST)' },

  // Europe
  { group: 'Europe', name: 'Germany', code: 'Germany', tz: 'GMT+2 (CEST)' },
  { group: 'Europe', name: 'France', code: 'France', tz: 'GMT+2 (CEST)' },
  { group: 'Europe', name: 'Ireland', code: 'Ireland', tz: 'GMT+1 (IST)' },
  { group: 'Europe', name: 'Italy', code: 'Italy', tz: 'GMT+2 (CEST)' },
  { group: 'Europe', name: 'Spain', code: 'Spain', tz: 'GMT+2 (CEST)' },
  { group: 'Europe', name: 'Netherlands', code: 'Netherlands', tz: 'GMT+2 (CEST)' },
  { group: 'Europe', name: 'Belgium', code: 'Belgium', tz: 'GMT+2 (CEST)' },
  { group: 'Europe', name: 'Sweden', code: 'Sweden', tz: 'GMT+2 (CEST)' },
  { group: 'Europe', name: 'Norway', code: 'Norway', tz: 'GMT+2 (CEST)' },
  { group: 'Europe', name: 'Denmark', code: 'Denmark', tz: 'GMT+2 (CEST)' },
  { group: 'Europe', name: 'Finland', code: 'Finland', tz: 'GMT+3 (EEST)' },
  { group: 'Europe', name: 'Switzerland', code: 'Switzerland', tz: 'GMT+2 (CEST)' },
  { group: 'Europe', name: 'Austria', code: 'Austria', tz: 'GMT+2 (CEST)' },
  { group: 'Europe', name: 'Poland', code: 'Poland', tz: 'GMT+2 (CEST)' },
  { group: 'Europe', name: 'Portugal', code: 'Portugal', tz: 'GMT+1 (WEST)' },
  { group: 'Europe', name: 'Greece', code: 'Greece', tz: 'GMT+3 (EEST)' },
  { group: 'Europe', name: 'Cyprus', code: 'Cyprus', tz: 'GMT+3 (EEST)' },
  { group: 'Europe', name: 'Malta', code: 'Malta', tz: 'GMT+2 (CEST)' },

  // Middle East & Central Asia
  { group: 'Middle East & Central Asia', name: 'Turkey', code: 'Turkey', tz: 'GMT+3 (TRT)' },
  { group: 'Middle East & Central Asia', name: 'Jordan', code: 'Jordan', tz: 'GMT+3 (AST)' },
  { group: 'Middle East & Central Asia', name: 'Lebanon', code: 'Lebanon', tz: 'GMT+3 (EEST)' },
  { group: 'Middle East & Central Asia', name: 'Iraq', code: 'Iraq', tz: 'GMT+3 (AST)' },
  { group: 'Middle East & Central Asia', name: 'Yemen', code: 'Yemen', tz: 'GMT+3 (AST)' },
  { group: 'Middle East & Central Asia', name: 'Egypt', code: 'Egypt', tz: 'GMT+3 (EEST)' },
  { group: 'Middle East & Central Asia', name: 'Azerbaijan', code: 'Azerbaijan', tz: 'GMT+4 (AZT)' },
  { group: 'Middle East & Central Asia', name: 'Uzbekistan', code: 'Uzbekistan', tz: 'GMT+5 (UZT)' },

  // Asia & Pacific
  { group: 'Asia & Pacific', name: 'New Zealand', code: 'New Zealand', tz: 'GMT+12 (NZST)' },
  { group: 'Asia & Pacific', name: 'Malaysia', code: 'Malaysia', tz: 'GMT+8 (MYT)' },
  { group: 'Asia & Pacific', name: 'Singapore', code: 'Singapore', tz: 'GMT+8 (SGT)' },
  { group: 'Asia & Pacific', name: 'Japan', code: 'Japan', tz: 'GMT+9 (JST)' },
  { group: 'Asia & Pacific', name: 'South Korea', code: 'South Korea', tz: 'GMT+9 (KST)' },
  { group: 'Asia & Pacific', name: 'India', code: 'India', tz: 'GMT+5:30 (IST)' },
  { group: 'Asia & Pacific', name: 'Bangladesh', code: 'Bangladesh', tz: 'GMT+6 (BST)' },
  { group: 'Asia & Pacific', name: 'Indonesia', code: 'Indonesia', tz: 'GMT+7 (WIB)' },
  { group: 'Asia & Pacific', name: 'Hong Kong', code: 'Hong Kong', tz: 'GMT+8 (HKT)' },
  { group: 'Asia & Pacific', name: 'Brunei', code: 'Brunei', tz: 'GMT+8 (BNT)' },
  { group: 'Asia & Pacific', name: 'Sri Lanka', code: 'Sri Lanka', tz: 'GMT+5:30 (IST)' },
  { group: 'Asia & Pacific', name: 'Philippines', code: 'Philippines', tz: 'GMT+8 (PHT)' },
  { group: 'Asia & Pacific', name: 'Thailand', code: 'Thailand', tz: 'GMT+7 (ICT)' },
  { group: 'Asia & Pacific', name: 'China', code: 'China', tz: 'GMT+8 (CST)' },

  // Africa
  { group: 'Africa', name: 'South Africa', code: 'South Africa', tz: 'GMT+2 (SAST)' },
  { group: 'Africa', name: 'Morocco', code: 'Morocco', tz: 'GMT+1 (WEST)' },
  { group: 'Africa', name: 'Algeria', code: 'Algeria', tz: 'GMT+1 (CET)' },
  { group: 'Africa', name: 'Tunisia', code: 'Tunisia', tz: 'GMT+1 (CET)' },
  { group: 'Africa', name: 'Kenya', code: 'Kenya', tz: 'GMT+3 (EAT)' },
  { group: 'Africa', name: 'Nigeria', code: 'Nigeria', tz: 'GMT+1 (WAT)' },
  { group: 'Africa', name: 'Mauritius', code: 'Mauritius', tz: 'GMT+4 (MUT)' },
  { group: 'Africa', name: 'Sudan', code: 'Sudan', tz: 'GMT+2 (CAT)' },
  { group: 'Africa', name: 'Ghana', code: 'Ghana', tz: 'GMT+0 (GMT)' },
  { group: 'Africa', name: 'Tanzania', code: 'Tanzania', tz: 'GMT+3 (EAT)' },

  // Americas & Caribbean
  { group: 'Americas & Caribbean', name: 'Mexico', code: 'Mexico', tz: 'GMT-6 (CST)' },
  { group: 'Americas & Caribbean', name: 'Brazil', code: 'Brazil', tz: 'GMT-3 (BRT)' },
  { group: 'Americas & Caribbean', name: 'Trinidad and Tobago', code: 'Trinidad and Tobago', tz: 'GMT-4 (AST)' },
  { group: 'Americas & Caribbean', name: 'Guyana', code: 'Guyana', tz: 'GMT-4 (GYT)' },
  { group: 'Americas & Caribbean', name: 'Argentina', code: 'Argentina', tz: 'GMT-3 (ART)' },
  { group: 'Americas & Caribbean', name: 'Chile', code: 'Chile', tz: 'GMT-3 (CLST)' },
  { group: 'Americas & Caribbean', name: 'Colombia', code: 'Colombia', tz: 'GMT-5 (COT)' },

  // Custom / Other
  { group: 'Custom Option', name: 'Other / Custom Country...', code: 'Other', tz: 'GMT+0' }
];

const COUNTRY_TIMEZONE_MAP = {};
WORLD_COUNTRIES.forEach(c => {
  COUNTRY_TIMEZONE_MAP[c.code] = c.tz;
  COUNTRY_TIMEZONE_MAP[c.name] = c.tz;
});
COUNTRY_TIMEZONE_MAP['US'] = 'GMT-5 (CST)';
COUNTRY_TIMEZONE_MAP['GB'] = 'GMT+1 (BST)';
COUNTRY_TIMEZONE_MAP['United Kingdom'] = 'GMT+1 (BST)';
COUNTRY_TIMEZONE_MAP['United States'] = 'GMT-5 (CST)';
COUNTRY_TIMEZONE_MAP['KSA'] = 'GMT+3 (AST)';

function populateCountryOptions(selectEl, selectedVal, placeholder = 'Select Country') {
  if (!selectEl) return;
  const groups = {};
  WORLD_COUNTRIES.forEach(c => {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  const hasSelection = Boolean(selectedVal);
  let html = `<option value="" disabled ${!hasSelection ? 'selected' : ''}>${placeholder}</option>`;
  let matchFound = false;
  for (const [groupName, countries] of Object.entries(groups)) {
    html += `<optgroup label="${groupName}">`;
    countries.forEach(c => {
      const isSelected = hasSelection && (
        (c.code.toLowerCase() === (selectedVal || '').toLowerCase()) ||
        (c.name.toLowerCase() === (selectedVal || '').toLowerCase())
      );
      if (isSelected) matchFound = true;
      html += `<option value="${c.code}" ${isSelected ? 'selected' : ''}>${c.name}</option>`;
    });
    html += `</optgroup>`;
  }
  selectEl.innerHTML = html;

  if (selectedVal && !matchFound && selectedVal !== 'Other') {
    selectEl.value = 'Other';
  } else if (!hasSelection) {
    selectEl.value = '';
  }
}

function handleEditCountryChange(country) {
  const customInput = document.getElementById('edit-schedule-custom-country');
  if (country === 'Other') {
    if (customInput) customInput.classList.remove('hidden');
  } else {
    if (customInput) customInput.classList.add('hidden');
  }

  const newTz = COUNTRY_TIMEZONE_MAP[country] || 'GMT+0';
  const tzInput = document.getElementById('edit-schedule-timezone');
  if (tzInput && country !== 'Other') {
    if (!tzInput.value || !tzInput.value.trim()) {
      tzInput.value = newTz;
    }
  }

  const tzDiffBadge = document.getElementById('edit-schedule-tz-diff');
  if (tzDiffBadge) tzDiffBadge.textContent = getTimezoneDiffLabel(tzInput ? tzInput.value : newTz);

  const tzCallout = document.getElementById('edit-schedule-student-tz-callout');
  const activeTz = tzInput ? tzInput.value : newTz;
  if (tzCallout) {
    if (activeTz) {
      tzCallout.textContent = `• Student Local: ${activeTz}`;
      tzCallout.classList.remove('hidden');
    } else {
      tzCallout.classList.add('hidden');
    }
  }

  const currentSched = getMatrixScheduleData('edit-schedule-matrix-container');
  renderWeeklyMatrixEditor('edit-schedule-matrix-container', currentSched, tzInput ? tzInput.value : newTz);
}

function handleEditTimezoneInput(tzVal) {
  const cleanTz = tzVal ? tzVal.trim() : 'GMT+0';
  const tzDiffBadge = document.getElementById('edit-schedule-tz-diff');
  if (tzDiffBadge) tzDiffBadge.textContent = getTimezoneDiffLabel(cleanTz);

  const tzCallout = document.getElementById('edit-schedule-student-tz-callout');
  if (tzCallout) {
    if (cleanTz) {
      tzCallout.textContent = `• Student Local: ${cleanTz}`;
      tzCallout.classList.remove('hidden');
    } else {
      tzCallout.classList.add('hidden');
    }
  }

  const currentSched = getMatrixScheduleData('edit-schedule-matrix-container');
  renderWeeklyMatrixEditor('edit-schedule-matrix-container', currentSched, cleanTz);
}

function handleEditStudentIdInput(val) {
  const badge = document.getElementById('edit-schedule-student-id-badge');
  if (badge) badge.textContent = `ID: ${val.trim() || '---'}`;
}

function handleEditFamilyIdInput(val) {
  const badge = document.getElementById('edit-schedule-family-badge');
  if (badge) badge.textContent = val.trim() || '---';
}

// ==========================================
// ==========================================
// SNAPCHAT-STYLE CARTOON AVATAR STUDIO & CANVAS CROPPER
// ==========================================

const CARTOON_SKIN_TONES = [
  { name: 'Fair', hex: '#FDE2D2', shadow: '#EBBCA7' },
  { name: 'Peach Warm', hex: '#F5D0B5', shadow: '#E0B596' },
  { name: 'Honey Warm', hex: '#E8B88A', shadow: '#D19E70' },
  { name: 'Olive Warm', hex: '#C68B59', shadow: '#AB7242' },
  { name: 'Deep Bronze', hex: '#8D5524', shadow: '#734117' },
  { name: 'Rich Espresso', hex: '#51311C', shadow: '#3B2110' }
];

const CARTOON_PALETTES = [
  { name: 'Jet Black', hex: '#1A1A1A' },
  { name: 'Dark Espresso', hex: '#362312' },
  { name: 'Academy Dark Teal', hex: '#0E4D45' },
  { name: 'Forest Emerald', hex: '#047857' },
  { name: 'Blush Rose', hex: '#E11D48' },
  { name: 'Royal Navy', hex: '#1E3A8A' },
  { name: 'Soft White', hex: '#F8FAFC' },
  { name: 'Golden Honey', hex: '#C99A49' }
];

const CARTOON_BG_TONES = [
  { name: 'Academy Teal', hex: '#0E4D45' },
  { name: 'Emerald Mint', hex: '#047857' },
  { name: 'Warm Amber', hex: '#FEF3C7' },
  { name: 'Sky Blue', hex: '#E0F2FE' },
  { name: 'Soft Rose', hex: '#FEE2E2' },
  { name: 'Charcoal Slate', hex: '#334155' }
];

const CARTOON_HEADWEAR_LIST = [
  { id: 'kufi_cap', label: 'Kufi Cap' },
  { id: 'hijab_classic', label: 'Classic Hijab' },
  { id: 'keffiyeh', label: 'Keffiyeh Scarf' },
  { id: 'neat', label: 'Short Classic' },
  { id: 'curly', label: 'Curly Fade' },
  { id: 'spiky', label: 'Modern Spiky' },
  { id: 'ponytail', label: 'Ponytail' }
];

const CARTOON_EXPRESSIONS = [
  { id: 'happy', label: 'Smile' },
  { id: 'grin', label: 'Big Grin' },
  { id: 'wink', label: 'Friendly Wink' },
  { id: 'studious', label: 'Studious' }
];

const CARTOON_GLASSES_LIST = [
  { id: 'none', label: 'None' },
  { id: 'round', label: 'Round Scholar' },
  { id: 'rect', label: 'Sleek Rect' },
  { id: 'sun', label: 'Cool Shades' }
];

const CARTOON_OUTFITS_LIST = [
  { id: 'thobe', label: 'White Thobe' },
  { id: 'teal_uniform', label: 'Academy Dark Teal' },
  { id: 'emerald', label: 'Emerald Uniform' },
  { id: 'hoodie', label: 'Casual Hoodie' }
];

const CartoonAvatarStudioState = {
  skinTone: '#F5D0B5',
  skinShadow: '#E0B596',
  headwear: 'kufi_cap',
  headwearColor: '#0E4D45',
  hairColor: '#1A1A1A',
  expression: 'happy',
  glasses: 'none',
  outfit: 'thobe',
  accessory: 'none',
  bgColor: '#0E4D45'
};

function generateCartoonAvatarSvg(opts) {
  const skin = opts.skinTone || '#F5D0B5';
  const skinShadow = opts.skinShadow || '#E0B596';
  const hairColor = opts.hairColor || '#1A1A1A';
  const headwearColor = opts.headwearColor || '#0E4D45';
  const bgColor = opts.bgColor || '#0E4D45';
  const id = 'cav_' + Math.random().toString(36).substr(2, 9);

  // 1. Background with subtle Islamic geometric / concentric rings
  const bgSvg = `
    <rect width="200" height="200" fill="${bgColor}"/>
    <circle cx="100" cy="100" r="86" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="2.5"/>
    <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4 4"/>
  `;

  // 2. Shoulders & Outfit
  let outfitSvg = '';
  if (opts.outfit === 'teal_uniform') {
    outfitSvg = `
      <path d="M28 200 C34 150 65 140 100 140 C135 140 166 150 172 200 Z" fill="#0E4D45"/>
      <path d="M88 140 L100 166 L112 140 Z" fill="#FFFFFF"/>
      <circle cx="100" cy="176" r="3" fill="#D97706"/>
      <circle cx="100" cy="190" r="3" fill="#D97706"/>
      <!-- Academy Gold Badge -->
      <rect x="62" y="162" width="16" height="20" rx="3" fill="#A3E635"/>
      <path d="M66 170 L70 174 L74 167" stroke="#0E4D45" stroke-width="2" fill="none"/>
    `;
  } else if (opts.outfit === 'emerald') {
    outfitSvg = `
      <path d="M28 200 C34 150 65 140 100 140 C135 140 166 150 172 200 Z" fill="#047857"/>
      <path d="M84 140 Q100 156 116 140 Z" fill="#FFFFFF"/>
      <circle cx="100" cy="165" r="3.5" fill="#FFFFFF"/>
      <circle cx="100" cy="180" r="3.5" fill="#FFFFFF"/>
    `;
  } else if (opts.outfit === 'hoodie') {
    outfitSvg = `
      <path d="M28 200 C34 150 65 140 100 140 C135 140 166 150 172 200 Z" fill="#1E293B"/>
      <path d="M78 142 C85 158 115 158 122 142 Z" fill="#334155"/>
      <line x1="92" y1="154" x2="92" y2="186" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round"/>
      <line x1="108" y1="154" x2="108" y2="186" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round"/>
    `;
  } else {
    // White Traditional Thobe / Jubbah
    outfitSvg = `
      <path d="M28 200 C34 150 65 140 100 140 C135 140 166 150 172 200 Z" fill="#F8FAFC"/>
      <!-- Thobe Mandarin Collar -->
      <path d="M85 136 C85 130 115 130 115 136 L115 148 L85 148 Z" fill="#E2E8F0"/>
      <path d="M96 148 L104 148 L104 200 L96 200 Z" fill="#E2E8F0"/>
      <circle cx="100" cy="158" r="2.5" fill="#94A3B8"/>
      <circle cx="100" cy="172" r="2.5" fill="#94A3B8"/>
      <circle cx="100" cy="186" r="2.5" fill="#94A3B8"/>
    `;
  }

  // 3. Neck & Chin Shadow
  const neckSvg = `
    <rect x="88" y="122" width="24" height="26" rx="4" fill="${skin}"/>
    <path d="M88 122 C94 130 106 130 112 122 Z" fill="${skinShadow}" opacity="0.6"/>
  `;

  // 4. Ears (omitted if Hijab)
  let earsSvg = '';
  if (opts.headwear !== 'hijab_classic') {
    earsSvg = `
      <circle cx="56" cy="98" r="9" fill="${skin}"/>
      <circle cx="56" cy="98" r="5" fill="${skinShadow}" opacity="0.5"/>
      <circle cx="144" cy="98" r="9" fill="${skin}"/>
      <circle cx="144" cy="98" r="5" fill="${skinShadow}" opacity="0.5"/>
    `;
  }

  // 5. Head Base & Cheeks
  const headSvg = `
    <ellipse cx="100" cy="96" rx="42" ry="46" fill="${skin}"/>
    <!-- Cheeks Blush -->
    <circle cx="73" cy="108" r="6" fill="#FB7185" opacity="0.35"/>
    <circle cx="127" cy="108" r="6" fill="#FB7185" opacity="0.35"/>
  `;

  // 6. Eyes & Expression
  let eyesSvg = '';
  if (opts.expression === 'grin') {
    eyesSvg = `
      <path d="M72 94 Q82 86 92 94" stroke="#1E293B" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path d="M108 94 Q118 86 128 94" stroke="#1E293B" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path d="M72 82 Q82 76 92 82" stroke="${hairColor}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M108 82 Q118 76 128 82" stroke="${hairColor}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    `;
  } else if (opts.expression === 'wink') {
    eyesSvg = `
      <ellipse cx="82" cy="94" rx="6.5" ry="7.5" fill="#FFFFFF"/>
      <circle cx="83" cy="94" r="4.5" fill="#1E293B"/>
      <circle cx="85" cy="92.5" r="1.5" fill="#FFFFFF"/>
      <path d="M108 95 Q118 87 128 95" stroke="#1E293B" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path d="M72 82 Q82 76 92 82" stroke="${hairColor}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M108 82 Q118 78 128 84" stroke="${hairColor}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    `;
  } else if (opts.expression === 'studious') {
    eyesSvg = `
      <ellipse cx="82" cy="94" rx="6" ry="7" fill="#FFFFFF"/>
      <circle cx="83" cy="94" r="4" fill="#1E293B"/>
      <circle cx="84.5" cy="92.5" r="1.5" fill="#FFFFFF"/>
      <ellipse cx="118" cy="94" rx="6" ry="7" fill="#FFFFFF"/>
      <circle cx="119" cy="94" r="4" fill="#1E293B"/>
      <circle cx="120.5" cy="92.5" r="1.5" fill="#FFFFFF"/>
      <path d="M73 80 Q82 78 91 82" stroke="${hairColor}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M109 82 Q118 78 127 80" stroke="${hairColor}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    `;
  } else {
    // Happy Default
    eyesSvg = `
      <ellipse cx="82" cy="94" rx="6.5" ry="7.5" fill="#FFFFFF"/>
      <circle cx="83" cy="94" r="4.5" fill="#1E293B"/>
      <circle cx="85" cy="92" r="1.5" fill="#FFFFFF"/>
      <ellipse cx="118" cy="94" rx="6.5" ry="7.5" fill="#FFFFFF"/>
      <circle cx="119" cy="94" r="4.5" fill="#1E293B"/>
      <circle cx="121" cy="92" r="1.5" fill="#FFFFFF"/>
      <path d="M72 82 Q82 77 92 82" stroke="${hairColor}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M108 82 Q118 77 128 82" stroke="${hairColor}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    `;
  }

  // 7. Nose & Mouth
  let mouthSvg = '';
  if (opts.expression === 'grin') {
    mouthSvg = `
      <path d="M98 103 Q100 105 102 103" stroke="#C68B59" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M85 113 Q100 128 115 113 Z" fill="#991B1B"/>
      <path d="M88 113 Q100 119 112 113 Z" fill="#FFFFFF"/>
    `;
  } else {
    mouthSvg = `
      <path d="M98 103 Q100 105 102 103" stroke="#C68B59" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M88 115 Q100 124 112 115" stroke="#991B1B" stroke-width="3" fill="none" stroke-linecap="round"/>
    `;
  }

  // 8. Hair & Headwear
  let hairHeadwearSvg = '';
  if (opts.headwear === 'hijab_classic') {
    hairHeadwearSvg = `
      <!-- Hijab Under-cap -->
      <path d="M64 80 C64 56 80 50 100 50 C120 50 136 56 136 80 Z" fill="#FFFFFF" opacity="0.9"/>
      <!-- Outer Hijab Wrap -->
      <path d="M46 145 C42 85 60 40 100 40 C140 40 158 85 154 145 C152 178 142 188 100 188 C58 188 48 178 46 145 Z" fill="${headwearColor}"/>
      <!-- Face Cutout / Opening -->
      <ellipse cx="100" cy="100" rx="34" ry="39" fill="${skin}"/>
      ${headSvg}
      ${eyesSvg}
      ${mouthSvg}
      <!-- Hijab Chin Wrap Drapery -->
      <path d="M66 102 C64 128 78 140 100 140 C122 140 136 128 134 102 C146 126 140 162 100 162 C60 162 54 126 66 102 Z" fill="${headwearColor}"/>
      <!-- Subtle Fabric Folds -->
      <path d="M72 135 Q100 148 128 135" stroke="rgba(0,0,0,0.15)" stroke-width="2" fill="none"/>
      <path d="M68 62 Q100 52 132 62" stroke="rgba(255,255,255,0.2)" stroke-width="2" fill="none"/>
    `;
  } else if (opts.headwear === 'kufi_cap') {
    hairHeadwearSvg = `
      <!-- Hair Base at Temples -->
      <path d="M57 90 C56 70 70 65 100 65 C130 65 144 70 143 90 Z" fill="${hairColor}"/>
      <!-- Kufi Cap -->
      <path d="M56 80 C56 46 76 40 100 40 C124 40 144 46 144 80 C132 84 68 84 56 80 Z" fill="${headwearColor}"/>
      <!-- Kufi Golden Stitching Band -->
      <path d="M58 76 C72 80 128 80 142 76 L142 81 C128 85 72 85 58 81 Z" fill="#D97706"/>
      <line x1="75" y1="77" x2="75" y2="80" stroke="#FFF" stroke-width="1.5"/>
      <line x1="85" y1="77" x2="85" y2="80" stroke="#FFF" stroke-width="1.5"/>
      <line x1="95" y1="77" x2="95" y2="80" stroke="#FFF" stroke-width="1.5"/>
      <line x1="105" y1="77" x2="105" y2="80" stroke="#FFF" stroke-width="1.5"/>
      <line x1="115" y1="77" x2="115" y2="80" stroke="#FFF" stroke-width="1.5"/>
      <line x1="125" y1="77" x2="125" y2="80" stroke="#FFF" stroke-width="1.5"/>
    `;
  } else if (opts.headwear === 'keffiyeh') {
    hairHeadwearSvg = `
      <!-- Traditional Keffiyeh Scarf Drape -->
      <path d="M48 140 C46 80 62 42 100 42 C138 42 154 80 152 140 C154 175 144 190 134 195 L66 195 C56 190 46 175 48 140 Z" fill="#F8FAFC"/>
      <!-- Red / Black Checked Pattern Accents -->
      <path d="M58 76 Q100 70 142 76" stroke="#B91C1C" stroke-width="2.5" fill="none" stroke-dasharray="3 3"/>
      <!-- Agal Black Crown Rope Bands -->
      <path d="M60 66 Q100 60 140 66" stroke="#1E293B" stroke-width="4.5" fill="none" stroke-linecap="round"/>
      <path d="M62 72 Q100 66 138 72" stroke="#1E293B" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    `;
  } else if (opts.headwear === 'curly') {
    hairHeadwearSvg = `
      <circle cx="62" cy="74" r="14" fill="${hairColor}"/>
      <circle cx="76" cy="58" r="15" fill="${hairColor}"/>
      <circle cx="94" cy="52" r="16" fill="${hairColor}"/>
      <circle cx="112" cy="54" r="16" fill="${hairColor}"/>
      <circle cx="128" cy="62" r="15" fill="${hairColor}"/>
      <circle cx="138" cy="76" r="14" fill="${hairColor}"/>
      <circle cx="60" cy="88" r="10" fill="${hairColor}"/>
      <circle cx="140" cy="88" r="10" fill="${hairColor}"/>
      <path d="M68 76 Q85 82 100 76 Q115 82 132 76 C135 60 65 60 68 76 Z" fill="${hairColor}"/>
    `;
  } else if (opts.headwear === 'spiky') {
    hairHeadwearSvg = `
      <path d="M56 86 C54 52 70 42 100 38 C130 42 146 52 144 86 C138 68 122 62 100 64 C78 66 64 74 56 86 Z" fill="${hairColor}"/>
      <!-- Spiky Top Tufts -->
      <polygon points="76,46 84,32 92,44" fill="${hairColor}"/>
      <polygon points="90,44 100,28 110,44" fill="${hairColor}"/>
      <polygon points="108,44 116,34 124,48" fill="${hairColor}"/>
    `;
  } else if (opts.headwear === 'ponytail') {
    hairHeadwearSvg = `
      <!-- High Ponytail Puff -->
      <circle cx="100" cy="36" r="14" fill="${hairColor}"/>
      <ellipse cx="100" cy="46" rx="8" ry="4" fill="#E11D48"/>
      <!-- Bangs -->
      <path d="M56 86 C54 52 72 44 100 44 C128 44 146 52 144 86 C135 68 120 62 100 64 C80 66 65 72 56 86 Z" fill="${hairColor}"/>
      <!-- Flowing Hair behind shoulders -->
      <path d="M54 90 C50 120 54 150 64 165 L56 165 C46 150 42 120 46 90 Z" fill="${hairColor}"/>
      <path d="M146 90 C150 120 146 150 136 165 L144 165 C154 150 158 120 154 90 Z" fill="${hairColor}"/>
    `;
  } else {
    // Short Neat Classic
    hairHeadwearSvg = `
      <path d="M56 86 C54 52 72 42 100 42 C128 42 146 52 144 86 C138 68 122 62 100 64 C78 66 64 74 56 86 Z" fill="${hairColor}"/>
      <path d="M56 84 L56 96 L60 90 Z" fill="${hairColor}"/>
      <path d="M144 84 L144 96 L140 90 Z" fill="${hairColor}"/>
    `;
  }

  // 9. Glasses & Eyewear
  let glassesSvg = '';
  if (opts.glasses === 'round') {
    glassesSvg = `
      <circle cx="82" cy="94" r="13" fill="none" stroke="#D97706" stroke-width="2.5"/>
      <circle cx="118" cy="94" r="13" fill="none" stroke="#D97706" stroke-width="2.5"/>
      <line x1="95" y1="94" x2="105" y2="94" stroke="#D97706" stroke-width="2.5"/>
      <line x1="69" y1="94" x2="57" y2="91" stroke="#D97706" stroke-width="2"/>
      <line x1="131" y1="94" x2="143" y2="91" stroke="#D97706" stroke-width="2"/>
      <path d="M74 88 Q80 84 86 88" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" fill="none"/>
    `;
  } else if (opts.glasses === 'rect') {
    glassesSvg = `
      <rect x="68" y="86" width="26" height="18" rx="4" fill="none" stroke="#1E293B" stroke-width="2.5"/>
      <rect x="106" y="86" width="26" height="18" rx="4" fill="none" stroke="#1E293B" stroke-width="2.5"/>
      <line x1="94" y1="95" x2="106" y2="95" stroke="#1E293B" stroke-width="2.5"/>
      <line x1="68" y1="92" x2="57" y2="90" stroke="#1E293B" stroke-width="2"/>
      <line x1="132" y1="92" x2="143" y2="90" stroke="#1E293B" stroke-width="2"/>
    `;
  } else if (opts.glasses === 'sun') {
    glassesSvg = `
      <path d="M68 87 L94 87 L90 104 L72 104 Z" fill="#1E293B"/>
      <path d="M106 87 L132 87 L128 104 L110 104 Z" fill="#1E293B"/>
      <line x1="94" y1="90" x2="106" y2="90" stroke="#1E293B" stroke-width="2.5"/>
      <path d="M72 89 L88 89" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"/>
      <path d="M110 89 L126 89" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"/>
    `;
  }

  // 10. Accessories
  let accessorySvg = '';
  if (opts.accessory === 'crescent_pin') {
    accessorySvg = `
      <g transform="translate(132, 118) scale(0.9)">
        <path d="M10 0 A 8 8 0 1 0 10 16 A 6 6 0 1 1 10 0 Z" fill="#FBBF24"/>
        <polygon points="12,7 13.5,8 12.8,9.8 11.2,9.8 10.5,8" fill="#FBBF24"/>
      </g>
    `;
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="100%" height="100%">
      <defs>
        <clipPath id="${id}">
          <circle cx="100" cy="100" r="100"/>
        </clipPath>
      </defs>
      <g clip-path="url(#${id})">
        ${bgSvg}
        ${outfitSvg}
        ${neckSvg}
        ${earsSvg}
        ${opts.headwear === 'hijab_classic' ? hairHeadwearSvg : `
          ${headSvg}
          ${eyesSvg}
          ${mouthSvg}
          ${hairHeadwearSvg}
        `}
        ${glassesSvg}
        ${accessorySvg}
      </g>
    </svg>
  `;
}

function updateCartoonStudioPreview() {
  const container = document.getElementById('cartoon-avatar-svg-container');
  const thumb = document.getElementById('avatar-modal-current-selection-thumb');
  if (!container) return;

  const svgStr = generateCartoonAvatarSvg(CartoonAvatarStudioState);
  container.innerHTML = svgStr;

  const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svgStr);
  AvatarPickerState.selectedAvatarUrl = dataUrl;
  if (thumb) thumb.src = dataUrl;

  renderCartoonStudioControls();
}

function renderCartoonStudioControls() {
  // 1. Skin Tones
  const skinContainer = document.getElementById('cartoon-skintone-picker');
  if (skinContainer) {
    skinContainer.innerHTML = CARTOON_SKIN_TONES.map(s => {
      const isSelected = CartoonAvatarStudioState.skinTone === s.hex;
      return `
        <button 
          type="button" 
          onclick="setCartoonSkinTone('${s.hex}', '${s.shadow}')"
          title="${s.name}"
          class="w-7 h-7 rounded-full border-2 transition-all cursor-pointer flex items-center justify-center ${isSelected ? 'border-[#0E4D45] scale-110 shadow-xs ring-2 ring-[#0E4D45]/20' : 'border-white hover:scale-105'}"
          style="background-color: ${s.hex};"
        >
          ${isSelected ? '<span class="text-[#0E4D45] text-[10px] font-bold">✓</span>' : ''}
        </button>
      `;
    }).join('');
  }

  // 2. Headwear Chips
  const headwearContainer = document.getElementById('cartoon-headwear-chips');
  if (headwearContainer) {
    headwearContainer.innerHTML = CARTOON_HEADWEAR_LIST.map(h => {
      const isSelected = CartoonAvatarStudioState.headwear === h.id;
      return `
        <button 
          type="button" 
          onclick="setCartoonHeadwear('${h.id}')"
          class="px-2 py-1 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer text-left truncate ${isSelected ? 'border-[#0E4D45] bg-[#E8EFEE] text-[#0E4D45] font-bold shadow-2xs' : 'border-[#CBD5E1] bg-white text-[#141F1E] hover:border-[#0E4D45]'}"
        >
          ${h.label}
        </button>
      `;
    }).join('');
  }

  // 3. Colors (Hair / Hijab)
  const colorContainer = document.getElementById('cartoon-color-picker');
  if (colorContainer) {
    colorContainer.innerHTML = CARTOON_PALETTES.map(c => {
      const isSelected = CartoonAvatarStudioState.headwearColor === c.hex || CartoonAvatarStudioState.hairColor === c.hex;
      return `
        <button 
          type="button" 
          onclick="setCartoonColor('${c.hex}')"
          title="${c.name}"
          class="w-6 h-6 rounded-full border-2 transition-all cursor-pointer flex items-center justify-center ${isSelected ? 'border-[#0E4D45] scale-110 shadow-xs ring-2 ring-[#0E4D45]/20' : 'border-white hover:scale-105'}"
          style="background-color: ${c.hex};"
        >
          ${isSelected ? '<span class="text-white text-[9px] font-bold">✓</span>' : ''}
        </button>
      `;
    }).join('');
  }

  // 4. Expression Chips
  const exprContainer = document.getElementById('cartoon-expression-chips');
  if (exprContainer) {
    exprContainer.innerHTML = CARTOON_EXPRESSIONS.map(e => {
      const isSelected = CartoonAvatarStudioState.expression === e.id;
      return `
        <button 
          type="button" 
          onclick="setCartoonExpression('${e.id}')"
          class="px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${isSelected ? 'border-[#0E4D45] bg-[#E8EFEE] text-[#0E4D45] font-bold shadow-2xs' : 'border-[#CBD5E1] bg-white text-[#141F1E] hover:border-[#0E4D45]'}"
        >
          ${e.label}
        </button>
      `;
    }).join('');
  }

  // 5. Glasses Chips
  const glassesContainer = document.getElementById('cartoon-glasses-chips');
  if (glassesContainer) {
    glassesContainer.innerHTML = CARTOON_GLASSES_LIST.map(g => {
      const isSelected = CartoonAvatarStudioState.glasses === g.id;
      return `
        <button 
          type="button" 
          onclick="setCartoonGlasses('${g.id}')"
          class="px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${isSelected ? 'border-[#0E4D45] bg-[#E8EFEE] text-[#0E4D45] font-bold shadow-2xs' : 'border-[#CBD5E1] bg-white text-[#141F1E] hover:border-[#0E4D45]'}"
        >
          ${g.label}
        </button>
      `;
    }).join('');
  }

  // 6. Outfit Chips
  const outfitContainer = document.getElementById('cartoon-outfit-chips');
  if (outfitContainer) {
    outfitContainer.innerHTML = CARTOON_OUTFITS_LIST.map(o => {
      const isSelected = CartoonAvatarStudioState.outfit === o.id;
      return `
        <button 
          type="button" 
          onclick="setCartoonOutfit('${o.id}')"
          class="px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${isSelected ? 'border-[#0E4D45] bg-[#E8EFEE] text-[#0E4D45] font-bold shadow-2xs' : 'border-[#CBD5E1] bg-white text-[#141F1E] hover:border-[#0E4D45]'}"
        >
          ${o.label}
        </button>
      `;
    }).join('');
  }

  // 7. Background Tone Chips
  const bgContainer = document.getElementById('cartoon-bg-picker');
  if (bgContainer) {
    bgContainer.innerHTML = CARTOON_BG_TONES.map(b => {
      const isSelected = CartoonAvatarStudioState.bgColor === b.hex;
      return `
        <button 
          type="button" 
          onclick="setCartoonBg('${b.hex}')"
          title="${b.name}"
          class="w-6 h-6 rounded-full border-2 transition-all cursor-pointer flex items-center justify-center ${isSelected ? 'border-[#0E4D45] scale-110 shadow-xs ring-2 ring-[#0E4D45]/20' : 'border-white hover:scale-105'}"
          style="background-color: ${b.hex};"
        >
          ${isSelected ? '<span class="text-white text-[9px] font-bold">✓</span>' : ''}
        </button>
      `;
    }).join('');
  }
}

function setCartoonPersona(personaKey) {
  if (personaKey === 'boy_kufi') {
    CartoonAvatarStudioState.headwear = 'kufi_cap';
    CartoonAvatarStudioState.headwearColor = '#0E4D45';
    CartoonAvatarStudioState.outfit = 'thobe';
    CartoonAvatarStudioState.glasses = 'none';
    CartoonAvatarStudioState.expression = 'happy';
    CartoonAvatarStudioState.bgColor = '#09342E';
  } else if (personaKey === 'girl_hijab') {
    CartoonAvatarStudioState.headwear = 'hijab_classic';
    CartoonAvatarStudioState.headwearColor = '#0E4D45';
    CartoonAvatarStudioState.outfit = 'teal_uniform';
    CartoonAvatarStudioState.accessory = 'crescent_pin';
    CartoonAvatarStudioState.glasses = 'none';
    CartoonAvatarStudioState.expression = 'happy';
    CartoonAvatarStudioState.bgColor = '#10B981';
  } else if (personaKey === 'scholar_glasses') {
    CartoonAvatarStudioState.headwear = 'neat';
    CartoonAvatarStudioState.hairColor = '#362312';
    CartoonAvatarStudioState.outfit = 'teal_uniform';
    CartoonAvatarStudioState.glasses = 'round';
    CartoonAvatarStudioState.expression = 'studious';
    CartoonAvatarStudioState.bgColor = '#1E3A8A';
  } else if (personaKey === 'casual_girl') {
    CartoonAvatarStudioState.headwear = 'ponytail';
    CartoonAvatarStudioState.hairColor = '#1A1A1A';
    CartoonAvatarStudioState.outfit = 'hoodie';
    CartoonAvatarStudioState.glasses = 'none';
    CartoonAvatarStudioState.expression = 'grin';
    CartoonAvatarStudioState.bgColor = '#FEE2E2';
  } else if (personaKey === 'keffiyeh_boy') {
    CartoonAvatarStudioState.headwear = 'keffiyeh';
    CartoonAvatarStudioState.outfit = 'thobe';
    CartoonAvatarStudioState.glasses = 'none';
    CartoonAvatarStudioState.expression = 'happy';
    CartoonAvatarStudioState.bgColor = '#0E4D45';
  }
  updateCartoonStudioPreview();
}

function setCartoonSkinTone(skinHex, shadowHex) {
  CartoonAvatarStudioState.skinTone = skinHex;
  CartoonAvatarStudioState.skinShadow = shadowHex;
  updateCartoonStudioPreview();
}

function setCartoonHeadwear(id) {
  CartoonAvatarStudioState.headwear = id;
  updateCartoonStudioPreview();
}

function setCartoonColor(hex) {
  CartoonAvatarStudioState.headwearColor = hex;
  CartoonAvatarStudioState.hairColor = hex;
  updateCartoonStudioPreview();
}

function setCartoonExpression(id) {
  CartoonAvatarStudioState.expression = id;
  updateCartoonStudioPreview();
}

function setCartoonGlasses(id) {
  CartoonAvatarStudioState.glasses = id;
  updateCartoonStudioPreview();
}

function setCartoonOutfit(id) {
  CartoonAvatarStudioState.outfit = id;
  updateCartoonStudioPreview();
}

function setCartoonBg(hex) {
  CartoonAvatarStudioState.bgColor = hex;
  updateCartoonStudioPreview();
}

function randomizeCartoonAvatar() {
  const randomSkin = CARTOON_SKIN_TONES[Math.floor(Math.random() * CARTOON_SKIN_TONES.length)];
  const randomHeadwear = CARTOON_HEADWEAR_LIST[Math.floor(Math.random() * CARTOON_HEADWEAR_LIST.length)];
  const randomColor = CARTOON_PALETTES[Math.floor(Math.random() * CARTOON_PALETTES.length)];
  const randomExpr = CARTOON_EXPRESSIONS[Math.floor(Math.random() * CARTOON_EXPRESSIONS.length)];
  const randomGlasses = CARTOON_GLASSES_LIST[Math.floor(Math.random() * CARTOON_GLASSES_LIST.length)];
  const randomOutfit = CARTOON_OUTFITS_LIST[Math.floor(Math.random() * CARTOON_OUTFITS_LIST.length)];
  const randomBg = CARTOON_BG_TONES[Math.floor(Math.random() * CARTOON_BG_TONES.length)];

  CartoonAvatarStudioState.skinTone = randomSkin.hex;
  CartoonAvatarStudioState.skinShadow = randomSkin.shadow;
  CartoonAvatarStudioState.headwear = randomHeadwear.id;
  CartoonAvatarStudioState.headwearColor = randomColor.hex;
  CartoonAvatarStudioState.hairColor = randomColor.hex;
  CartoonAvatarStudioState.expression = randomExpr.id;
  CartoonAvatarStudioState.glasses = randomGlasses.id;
  CartoonAvatarStudioState.outfit = randomOutfit.id;
  CartoonAvatarStudioState.bgColor = randomBg.hex;

  updateCartoonStudioPreview();
}

function resetCartoonAvatar() {
  CartoonAvatarStudioState.skinTone = '#F5D0B5';
  CartoonAvatarStudioState.skinShadow = '#E0B596';
  CartoonAvatarStudioState.headwear = 'kufi_cap';
  CartoonAvatarStudioState.headwearColor = '#0E4D45';
  CartoonAvatarStudioState.hairColor = '#1A1A1A';
  CartoonAvatarStudioState.expression = 'happy';
  CartoonAvatarStudioState.glasses = 'none';
  CartoonAvatarStudioState.outfit = 'thobe';
  CartoonAvatarStudioState.bgColor = '#0E4D45';
  updateCartoonStudioPreview();
}

// ==========================================
// INTERACTIVE CANVAS IMAGE CROPPER ENGINE
// ==========================================

const CropToolState = {
  image: null,
  rawFile: null,
  scale: 1,
  minScale: 0.3,
  maxScale: 3.5,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  eventsInitialized: false,
  canvasWidth: 280,
  canvasHeight: 280,
  cropRadius: 105
};

function initCropCanvasEvents() {
  if (CropToolState.eventsInitialized) return;
  const canvas = document.getElementById('avatar-crop-canvas');
  if (!canvas) return;

  // Mouse drag handlers
  canvas.addEventListener('mousedown', (e) => {
    CropToolState.isDragging = true;
    CropToolState.dragStartX = e.clientX - CropToolState.offsetX;
    CropToolState.dragStartY = e.clientY - CropToolState.offsetY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!CropToolState.isDragging) return;
    CropToolState.offsetX = e.clientX - CropToolState.dragStartX;
    CropToolState.offsetY = e.clientY - CropToolState.dragStartY;
    drawCropCanvas();
  });

  window.addEventListener('mouseup', () => {
    if (CropToolState.isDragging) {
      CropToolState.isDragging = false;
      autoSyncCroppedSelection();
    }
  });

  // Touch drag handlers
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      CropToolState.isDragging = true;
      CropToolState.dragStartX = e.touches[0].clientX - CropToolState.offsetX;
      CropToolState.dragStartY = e.touches[0].clientY - CropToolState.offsetY;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (!CropToolState.isDragging || e.touches.length !== 1) return;
    CropToolState.offsetX = e.touches[0].clientX - CropToolState.dragStartX;
    CropToolState.offsetY = e.touches[0].clientY - CropToolState.dragStartY;
    drawCropCanvas();
  }, { passive: true });

  canvas.addEventListener('touchend', () => {
    if (CropToolState.isDragging) {
      CropToolState.isDragging = false;
      autoSyncCroppedSelection();
    }
  });

  // Mouse wheel zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    adjustCropZoom(delta);
  }, { passive: false });

  CropToolState.eventsInitialized = true;
}

function drawCropCanvas() {
  const canvas = document.getElementById('avatar-crop-canvas');
  if (!canvas || !CropToolState.image) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const r = CropToolState.cropRadius;
  const cx = w / 2;
  const cy = h / 2;

  ctx.clearRect(0, 0, w, h);

  // 1. Draw Image with pan, zoom, and rotation
  ctx.save();
  ctx.translate(cx + CropToolState.offsetX, cy + CropToolState.offsetY);
  ctx.rotate((CropToolState.rotation * Math.PI) / 180);
  ctx.scale(CropToolState.scale, CropToolState.scale);
  const img = CropToolState.image;
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();

  // 2. Draw dark vignette outside the circular cutout
  ctx.save();
  ctx.fillStyle = 'rgba(14, 31, 28, 0.70)';
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.restore();

  // 3. Draw circular crop boundary guide
  ctx.save();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // 4. Subtle inner focus ring
  ctx.strokeStyle = '#A3E635';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function handleCropZoomSlider(val) {
  CropToolState.scale = Number(val) / 100;
  const label = document.getElementById('crop-zoom-label');
  if (label) label.textContent = `${Math.round(val)}%`;
  drawCropCanvas();
  autoSyncCroppedSelection();
}

function adjustCropZoom(delta) {
  CropToolState.scale = Math.max(CropToolState.minScale, Math.min(CropToolState.maxScale, CropToolState.scale + delta));
  const slider = document.getElementById('crop-zoom-slider');
  const label = document.getElementById('crop-zoom-label');
  const pct = Math.round(CropToolState.scale * 100);
  if (slider) slider.value = pct;
  if (label) label.textContent = `${pct}%`;
  drawCropCanvas();
  autoSyncCroppedSelection();
}

function rotateCropImage(degrees) {
  CropToolState.rotation = (CropToolState.rotation + degrees) % 360;
  drawCropCanvas();
  autoSyncCroppedSelection();
}

function resetCropTransform() {
  if (!CropToolState.image) return;
  const img = CropToolState.image;
  const targetDiameter = CropToolState.cropRadius * 2;
  const fitScale = Math.max(targetDiameter / img.width, targetDiameter / img.height);
  CropToolState.scale = fitScale;
  CropToolState.rotation = 0;
  CropToolState.offsetX = 0;
  CropToolState.offsetY = 0;

  const slider = document.getElementById('crop-zoom-slider');
  const label = document.getElementById('crop-zoom-label');
  const pct = Math.round(fitScale * 100);
  if (slider) slider.value = pct;
  if (label) label.textContent = `${pct}%`;

  drawCropCanvas();
  autoSyncCroppedSelection();
}

function generateCropDataUrl() {
  if (!CropToolState.image) return '';
  try {
    const offscreen = document.createElement('canvas');
    offscreen.width = 256;
    offscreen.height = 256;
    const octx = offscreen.getContext('2d');

    // Clip to circle
    octx.beginPath();
    octx.arc(128, 128, 128, 0, Math.PI * 2);
    octx.clip();

    // Mapping from workbench view (radius 105 at center 140,140) to 256x256 (radius 128 at center 128,128)
    const ratio = 128 / CropToolState.cropRadius;
    octx.translate(128 + CropToolState.offsetX * ratio, 128 + CropToolState.offsetY * ratio);
    octx.rotate((CropToolState.rotation * Math.PI) / 180);
    octx.scale(CropToolState.scale * ratio, CropToolState.scale * ratio);

    const img = CropToolState.image;
    octx.drawImage(img, -img.width / 2, -img.height / 2);

    return offscreen.toDataURL('image/png');
  } catch (err) {
    console.warn('Canvas crop export error:', err);
    return CropToolState.image.src || '';
  }
}

function autoSyncCroppedSelection() {
  const dataUrl = generateCropDataUrl();
  if (dataUrl) {
    AvatarPickerState.selectedAvatarUrl = dataUrl;
    const thumb = document.getElementById('avatar-modal-current-selection-thumb');
    if (thumb) thumb.src = dataUrl;
  }
}

function executeCropAndApply() {
  const dataUrl = generateCropDataUrl();
  if (!dataUrl) {
    alert('Please upload an image first.');
    return;
  }
  AvatarPickerState.selectedAvatarUrl = dataUrl;
  const thumb = document.getElementById('avatar-modal-current-selection-thumb');
  if (thumb) thumb.src = dataUrl;

  const banner = document.getElementById('crop-success-banner');
  if (banner) {
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 3500);
  }
  showToastNotification('✓ Photo cropped into circular profile! Click Apply to use.');
}

function processAvatarFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Please select a valid image file (JPG, PNG, WEBP, etc.).');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    alert('Image size exceeds 8MB. Please choose a smaller photo.');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      CropToolState.image = img;
      CropToolState.rawFile = file;

      // Show Cropper Workbench and Hide Dropzone
      const dropZone = document.getElementById('avatar-drop-zone');
      const workbench = document.getElementById('avatar-cropper-workbench');
      const filenameSpan = document.getElementById('cropper-filename');

      if (dropZone) dropZone.classList.add('hidden');
      if (workbench) workbench.classList.remove('hidden');
      if (filenameSpan) filenameSpan.textContent = file.name;

      initCropCanvasEvents();
      resetCropTransform();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function handleAvatarDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropZone = document.getElementById('avatar-drop-zone');
  if (dropZone) dropZone.classList.add('border-[#0E4D45]', 'bg-[#E8EFEE]');
}

function handleAvatarDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropZone = document.getElementById('avatar-drop-zone');
  if (dropZone) dropZone.classList.remove('border-[#0E4D45]', 'bg-[#E8EFEE]');
}

function handleAvatarDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropZone = document.getElementById('avatar-drop-zone');
  if (dropZone) dropZone.classList.remove('border-[#0E4D45]', 'bg-[#E8EFEE]');
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    processAvatarFile(e.dataTransfer.files[0]);
  }
}

function handleDeviceAvatarFile(e) {
  if (e.target && e.target.files && e.target.files.length > 0) {
    processAvatarFile(e.target.files[0]);
  }
}

// ==========================================
// PRESETS & INITIALS GENERATOR
// ==========================================

const PRESET_AVATARS = [
  {
    id: 'preset-boy-1',
    label: 'Tariq',
    url: 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=150&h=150&fit=crop&crop=faces'
  },
  {
    id: 'preset-girl-1',
    label: 'Zahra (Hijab)',
    url: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=150&h=150&fit=crop&crop=faces'
  },
  {
    id: 'preset-boy-2',
    label: 'Hamza',
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=faces'
  },
  {
    id: 'preset-girl-2',
    label: 'Maryam',
    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop&crop=faces'
  },
  {
    id: 'preset-boy-3',
    label: 'Zaid',
    url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=faces'
  },
  {
    id: 'preset-girl-3',
    label: 'Amina (Hijab)',
    url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&h=150&fit=crop&crop=faces'
  },
  {
    id: 'preset-boy-4',
    label: 'Bilal',
    url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&h=150&fit=crop&crop=faces'
  },
  {
    id: 'preset-girl-4',
    label: 'Fatima',
    url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&h=150&fit=crop&crop=faces'
  },
  {
    id: 'preset-illust-1',
    label: 'Student 1',
    url: 'https://api.dicebear.com/7.x/open-peeps/svg?seed=Ahmad&backgroundColor=b6e3f4'
  },
  {
    id: 'preset-illust-2',
    label: 'Student 2',
    url: 'https://api.dicebear.com/7.x/open-peeps/svg?seed=Aisha&backgroundColor=ffdfbf'
  },
  {
    id: 'preset-illust-3',
    label: 'Student 3',
    url: 'https://api.dicebear.com/7.x/open-peeps/svg?seed=Ibrahim&backgroundColor=c0aede'
  },
  {
    id: 'preset-illust-4',
    label: 'Student 4',
    url: 'https://api.dicebear.com/7.x/open-peeps/svg?seed=Khadija&backgroundColor=d1d4f9'
  }
];

const INITIALS_PALETTE = [
  { name: 'Academy Dark Teal', hex: '0E4D45' },
  { name: 'Emerald Green', hex: '10B981' },
  { name: 'Warm Amber', hex: 'D97706' },
  { name: 'Royal Indigo', hex: '4F46E5' },
  { name: 'Ruby Rose', hex: 'E11D48' },
  { name: 'Charcoal Slate', hex: '334155' },
  { name: 'Ocean Cyan', hex: '0891B2' },
  { name: 'Soft Violet', hex: '7C3AED' }
];

const AvatarPickerState = {
  targetForm: 'edit',
  currentTab: 'studio',
  selectedAvatarUrl: '',
  selectedInitialsBg: '0E4D45',
  initialsText: 'ST'
};

function generateInitialsDataUrl(initials, bgHex) {
  const cleanInitials = (initials || 'ST').toUpperCase().slice(0, 3);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
    <rect width="128" height="128" rx="64" fill="#${bgHex}"/>
    <text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="700" fill="#FFFFFF" text-anchor="middle" dominant-baseline="middle">${cleanInitials}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function renderPresetAvatarsGrid() {
  const container = document.getElementById('preset-avatars-grid');
  if (!container) return;

  container.innerHTML = PRESET_AVATARS.map(avatar => {
    const isSelected = AvatarPickerState.selectedAvatarUrl === avatar.url;
    return `
      <button 
        type="button" 
        onclick="selectPresetAvatar('${avatar.url}')"
        class="group relative flex flex-col items-center p-2 rounded-2xl border-2 transition-all cursor-pointer bg-white hover:bg-[#F8F6F1] ${isSelected ? 'border-[#0E4D45] ring-2 ring-[#0E4D45]/20 bg-[#E8EFEE]/30' : 'border-[#ECEAE4] hover:border-[#CBD5E1]'}"
      >
        <div class="relative w-14 h-14 rounded-full overflow-hidden border border-[#ECEAE4] group-hover:scale-105 transition-transform bg-white">
          <img src="${avatar.url}" alt="${avatar.label}" class="w-full h-full object-cover" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(avatar.label)}&background=0E4D45&color=fff';" />
          ${isSelected ? `
            <div class="absolute inset-0 bg-[#0E4D45]/25 flex items-center justify-center">
              <span class="w-5 h-5 rounded-full bg-[#0E4D45] text-white text-[10px] flex items-center justify-center font-bold shadow-xs">✓</span>
            </div>
          ` : ''}
        </div>
        <span class="text-[10px] font-semibold text-[#141F1E] mt-1.5 truncate max-w-[75px]">${avatar.label}</span>
      </button>
    `;
  }).join('');
}

function selectPresetAvatar(url) {
  AvatarPickerState.selectedAvatarUrl = url;
  const thumb = document.getElementById('avatar-modal-current-selection-thumb');
  if (thumb) thumb.src = url;
  renderPresetAvatarsGrid();
}

function renderInitialsPalette() {
  const container = document.getElementById('initials-color-picker');
  if (!container) return;

  container.innerHTML = INITIALS_PALETTE.map(col => {
    const isSelected = AvatarPickerState.selectedInitialsBg.toLowerCase() === col.hex.toLowerCase();
    return `
      <button 
        type="button" 
        onclick="selectInitialsColor('${col.hex}')"
        title="${col.name}"
        class="w-7 h-7 rounded-full border-2 transition-all cursor-pointer flex items-center justify-center ${isSelected ? 'border-[#0E4D45] scale-110 shadow-xs' : 'border-white hover:scale-105'}"
        style="background-color: #${col.hex};"
      >
        ${isSelected ? '<span class="text-white text-[10px] font-bold">✓</span>' : ''}
      </button>
    `;
  }).join('');
}

function selectInitialsColor(bgHex) {
  AvatarPickerState.selectedInitialsBg = bgHex;
  renderInitialsPalette();
  updateInitialsPreview();
}

function handleCustomInitialsInput(val) {
  AvatarPickerState.initialsText = (val || 'ST').toUpperCase();
  updateInitialsPreview();
}

function updateInitialsPreview() {
  const badge = document.getElementById('initials-preview-badge');
  const input = document.getElementById('initials-custom-text');
  const thumb = document.getElementById('avatar-modal-current-selection-thumb');

  const text = (AvatarPickerState.initialsText || 'ST').toUpperCase().slice(0, 3);
  if (badge) {
    badge.textContent = text;
    badge.style.backgroundColor = '#' + AvatarPickerState.selectedInitialsBg;
  }
  if (input && input.value !== text) {
    input.value = text;
  }

  const generatedUrl = generateInitialsDataUrl(text, AvatarPickerState.selectedInitialsBg);
  AvatarPickerState.selectedAvatarUrl = generatedUrl;
  if (thumb) {
    thumb.src = generatedUrl;
  }
}

// ==========================================
// UNIFIED AVATAR MODAL CONTROLLERS
// ==========================================

function openAvatarPickerModal(target = 'edit') {
  AvatarPickerState.targetForm = target;
  const modal = document.getElementById('avatar-picker-modal');
  if (!modal) return;

  let currentAvatar = '';
  let firstName = '';
  let lastName = '';

  if (target === 'edit') {
    currentAvatar = document.getElementById('edit-schedule-avatar')?.value || 
                    document.getElementById('edit-student-avatar-preview')?.src || '';
    firstName = document.getElementById('edit-schedule-first-name')?.value?.trim() || '';
    lastName = document.getElementById('edit-schedule-last-name')?.value?.trim() || '';
  } else {
    currentAvatar = document.getElementById('add-student-avatar')?.value || 
                    document.getElementById('add-student-avatar-preview')?.src || '';
    firstName = document.getElementById('add-student-first-name')?.value?.trim() || '';
    lastName = document.getElementById('add-student-last-name')?.value?.trim() || '';
  }

  // Derive initials
  let derivedInitials = 'ST';
  if (firstName || lastName) {
    const f = firstName ? firstName.charAt(0) : '';
    const l = lastName ? lastName.charAt(0) : '';
    derivedInitials = (f + l).toUpperCase() || firstName.slice(0, 2).toUpperCase() || 'ST';
  }
  AvatarPickerState.initialsText = derivedInitials;

  const charTitle = document.getElementById('cartoon-character-title');
  if (charTitle) {
    charTitle.textContent = firstName ? `${firstName}'s Cartoon Avatar` : 'Student Vector Avatar';
  }

  // Fallback selection
  AvatarPickerState.selectedAvatarUrl = currentAvatar || PRESET_AVATARS[0].url;

  // Render modal components
  renderCartoonStudioControls();
  renderPresetAvatarsGrid();
  renderInitialsPalette();

  // Tab auto-selection
  if (currentAvatar && currentAvatar.includes('cav_')) {
    switchAvatarPickerTab('studio');
  } else if (currentAvatar && (currentAvatar.startsWith('data:image/svg') || currentAvatar.includes('ui-avatars.com'))) {
    switchAvatarPickerTab('initials');
  } else if (PRESET_AVATARS.some(p => p.url === currentAvatar)) {
    switchAvatarPickerTab('presets');
  } else {
    switchAvatarPickerTab('studio');
  }

  modal.classList.add('active');
}

function closeAvatarPickerModal() {
  const modal = document.getElementById('avatar-picker-modal');
  if (modal) modal.classList.remove('active');
}

function switchAvatarPickerTab(tabName) {
  AvatarPickerState.currentTab = tabName;
  const tabs = ['studio', 'device', 'presets', 'initials'];
  
  tabs.forEach(t => {
    const btn = document.getElementById(`avatar-tab-btn-${t}`);
    const pane = document.getElementById(`avatar-tab-pane-${t}`);
    const isActive = t === tabName;
    
    if (btn) {
      if (isActive) {
        btn.className = 'px-3.5 py-2 rounded-t-xl text-xs font-bold border-b-2 border-[#0E4D45] text-[#0E4D45] bg-[#F8F6F1] flex items-center gap-1.5 transition-all cursor-pointer';
      } else {
        btn.className = 'px-3.5 py-2 rounded-t-xl text-xs font-bold border-b-2 border-transparent text-[#7A8684] hover:text-[#141F1E] flex items-center gap-1.5 transition-all cursor-pointer';
      }
    }
    if (pane) {
      if (isActive) {
        pane.classList.remove('hidden');
      } else {
        pane.classList.add('hidden');
      }
    }
  });

  if (tabName === 'studio') {
    updateCartoonStudioPreview();
  } else if (tabName === 'initials') {
    updateInitialsPreview();
  } else if (tabName === 'device' && CropToolState.image) {
    setTimeout(drawCropCanvas, 50);
  }
}

function applySelectedAvatar() {
  const selected = AvatarPickerState.selectedAvatarUrl;
  if (!selected) {
    alert('Please select, crop, or create an avatar first.');
    return;
  }

  if (AvatarPickerState.targetForm === 'edit') {
    const preview = document.getElementById('edit-student-avatar-preview');
    const input = document.getElementById('edit-schedule-avatar');
    if (preview) preview.src = selected;
    if (input) input.value = selected;
  } else {
    const preview = document.getElementById('add-student-avatar-preview');
    const input = document.getElementById('add-student-avatar');
    if (preview) preview.src = selected;
    if (input) input.value = selected;
  }

  closeAvatarPickerModal();
  showToastNotification('✓ Profile photo / avatar applied! Remember to save student changes.');
}

function openEditScheduleModal(studentId) {
  const modal = document.getElementById('edit-schedule-modal');
  if (!modal) return;

  const student = AppState.students.find(s => s.id === studentId);
  if (!student) return;

  // Student ID & Badges
  const origIdInput = document.getElementById('edit-schedule-original-id');
  if (origIdInput) origIdInput.value = student.id;

  const idInput = document.getElementById('edit-schedule-student-id-input');
  if (idInput) idInput.value = student.id;

  const idBadge = document.getElementById('edit-schedule-student-id-badge');
  if (idBadge) idBadge.textContent = `ID: ${student.id}`;

  const famBadge = document.getElementById('edit-schedule-family-badge');
  if (famBadge) famBadge.textContent = student.familyId || 'FAM-101';

  // Student Names
  const firstNameInput = document.getElementById('edit-schedule-first-name');
  if (firstNameInput) firstNameInput.value = student.firstName || '';

  const lastNameInput = document.getElementById('edit-schedule-last-name');
  if (lastNameInput) lastNameInput.value = student.lastName || '';

  // Guardian Details
  const guardianInput = document.getElementById('edit-schedule-guardian-name');
  if (guardianInput) guardianInput.value = student.guardianName || '';

  const phoneInput = document.getElementById('edit-schedule-phone');
  if (phoneInput) phoneInput.value = student.phone || '';

  const whatsappInput = document.getElementById('edit-schedule-whatsapp');
  if (whatsappInput) whatsappInput.value = student.whatsapp || student.phone || '';

  const emailInput = document.getElementById('edit-schedule-email');
  if (emailInput) emailInput.value = student.email || '';

  const addressInput = document.getElementById('edit-schedule-address');
  if (addressInput) {
    const isAutoGeneratedPattern = /^[A-Za-z\s]+\s*\((?:GMT|UTC)[^)]*\)$/.test(student.address || '');
    addressInput.value = isAutoGeneratedPattern ? '' : (student.address || '');
  }

  // Populate Country dropdown
  const countrySelect = document.getElementById('edit-schedule-country');
  const customCountryInput = document.getElementById('edit-schedule-custom-country');
  if (countrySelect) {
    populateCountryOptions(countrySelect, student.country);
    if (countrySelect.value === 'Other') {
      if (customCountryInput) {
        customCountryInput.classList.remove('hidden');
        customCountryInput.value = student.country !== 'Other' ? student.country : '';
      }
    } else {
      if (customCountryInput) {
        customCountryInput.classList.add('hidden');
        customCountryInput.value = '';
      }
    }
  }

  // Populate Timezone input
  const tzInput = document.getElementById('edit-schedule-timezone');
  const currentTz = student.timezone || COUNTRY_TIMEZONE_MAP[student.country] || 'GMT+1 (BST)';
  if (tzInput) {
    tzInput.value = currentTz;
  }

  const tzDiffBadge = document.getElementById('edit-schedule-tz-diff');
  if (tzDiffBadge) {
    tzDiffBadge.textContent = getTimezoneDiffLabel(currentTz);
  }

  // Populate teachers dropdown
  const teacherSelect = document.getElementById('edit-schedule-teacher');
  if (teacherSelect) {
    const rawTid = String(student.teacherId || '').trim();
    const rawTname = String(student.teacherName || '').trim();
    const rawAssigned = String(student.assignedTeacher || '').trim();
    const isUnassignedRecord = !rawTid || rawTid.toLowerCase() === 'unassigned' || rawTid.toLowerCase() === 't-unassigned' ||
                               rawTname.toLowerCase() === 'unassigned' || rawAssigned.toLowerCase() === 'unassigned' || rawAssigned.toLowerCase() === 'teacher unassigned';

    const matchedTeacher = !isUnassignedRecord ? (AppState.teachers || []).find(t => {
      const tid = String(t.id).trim().toLowerCase();
      const tname = String(t.name).trim().toLowerCase();
      return (rawTid && (tid === rawTid.toLowerCase() || tname === rawTid.toLowerCase())) ||
             (rawTname && (tname === rawTname.toLowerCase() || tid === rawTname.toLowerCase())) ||
             (rawAssigned && (tname === rawAssigned.toLowerCase() || tid === rawAssigned.toLowerCase()));
    }) : null;

    const isUnassigned = !matchedTeacher;
    let optionsHtml = `<option value="" ${isUnassigned ? 'selected' : ''}>Unassigned</option>`;
    if (AppState.teachers && AppState.teachers.length > 0) {
      optionsHtml += AppState.teachers.map(t => {
        const isMatch = matchedTeacher && (matchedTeacher.id === t.id);
        return `
          <option value="${t.id}" ${isMatch ? 'selected' : ''}>
            ${t.name}
          </option>
        `;
      }).join('');
    }
    teacherSelect.innerHTML = optionsHtml;
  }

  // Set course
  const courseSelect = document.getElementById('edit-schedule-course');
  if (courseSelect) {
    const targetCourse = student.course || 'Qaida for Beginners';
    courseSelect.value = targetCourse;
  }

  // Class Duration (per-student; old records without one count as 30 min)
  const durationSelect = document.getElementById('edit-schedule-class-duration');
  if (durationSelect) {
    const d = Number(student.classDuration);
    durationSelect.value = (d === 15 || d === 30 || d === 60) ? String(d) : '30';
  }

  // Tuition Fee & Currency
  const currencySelect = document.getElementById('edit-schedule-currency');
  if (currencySelect) currencySelect.value = student.currencyCode || 'USD';

  const feeInput = document.getElementById('edit-schedule-fee');
  if (feeInput) feeInput.value = student.monthlyFee !== undefined ? student.monthlyFee : 50;

  const familyIdInput = document.getElementById('edit-schedule-family-id');
  if (familyIdInput) familyIdInput.value = student.familyId || '';

  const statusSelect = document.getElementById('edit-schedule-status');
  if (statusSelect) statusSelect.value = student.academicStatus || 'Active';

  const avatarInput = document.getElementById('edit-schedule-avatar');
  if (avatarInput) avatarInput.value = student.avatar || '';

  const avatarPreview = document.getElementById('edit-student-avatar-preview');
  if (avatarPreview) {
    avatarPreview.src = student.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.firstName)}+${encodeURIComponent(student.lastName||'')}&background=0E4D45&color=fff`;
  }

  // Update Student Timezone Callout in Schedule Header
  const tzCallout = document.getElementById('edit-schedule-student-tz-callout');
  if (tzCallout) {
    if (currentTz) {
      tzCallout.textContent = `• Student Local: ${currentTz}`;
      tzCallout.classList.remove('hidden');
    } else {
      tzCallout.classList.add('hidden');
    }
  }

  // Render 7-Day Matrix Editor
  renderWeeklyMatrixEditor('edit-schedule-matrix-container', getStudentWeeklySchedule(student), currentTz);

  modal.classList.add('active');
}

function closeEditScheduleModal() {
  const modal = document.getElementById('edit-schedule-modal');
  if (modal) modal.classList.remove('active');
}

function handleSaveEditSchedule() {
  const originalId = document.getElementById('edit-schedule-original-id')?.value;
  const student = AppState.students.find(s => s.id === originalId);
  if (!student) return;

  const newId = document.getElementById('edit-schedule-student-id-input')?.value?.trim();
  const firstName = document.getElementById('edit-schedule-first-name')?.value?.trim();
  const lastName = document.getElementById('edit-schedule-last-name')?.value?.trim() || '';
  const guardianName = document.getElementById('edit-schedule-guardian-name')?.value?.trim();
  const phone = document.getElementById('edit-schedule-phone')?.value?.trim();
  const whatsapp = document.getElementById('edit-schedule-whatsapp')?.value?.trim() || phone;
  const email = document.getElementById('edit-schedule-email')?.value?.trim() || student.email || '';
  const addressEl = document.getElementById('edit-schedule-address');
  const address = addressEl ? addressEl.value.trim() : (student.address || '');
  
  let selectedCountry = document.getElementById('edit-schedule-country')?.value || student.country;
  if (selectedCountry === 'Other') {
    const customVal = document.getElementById('edit-schedule-custom-country')?.value?.trim();
    if (customVal) selectedCountry = customVal;
  }
  const newCountry = selectedCountry;
  const newTimezone = document.getElementById('edit-schedule-timezone')?.value?.trim() || student.timezone;
  const newTeacherId = document.getElementById('edit-schedule-teacher')?.value;
  const newCourse = document.getElementById('edit-schedule-course')?.value;
  const currencyCode = document.getElementById('edit-schedule-currency')?.value || student.currencyCode || 'USD';
  const monthlyFee = Number(document.getElementById('edit-schedule-fee')?.value) || student.monthlyFee || 50;
  const familyId = document.getElementById('edit-schedule-family-id')?.value?.trim() || student.familyId;
  const newWeeklySchedule = getMatrixScheduleData('edit-schedule-matrix-container');

  if (!newId) {
    alert('Please enter a valid Student ID / Roll Number.');
    return;
  }

  if (!firstName || !guardianName || !phone) {
    alert('Please enter Student First Name, Guardian Full Name, and Primary Phone.');
    return;
  }

  // Check unique ID if ID was modified
  if (newId.toLowerCase() !== originalId.toLowerCase()) {
    const isDuplicate = AppState.students.some(s => s.id.toLowerCase() === newId.toLowerCase() && s.id !== originalId);
    if (isDuplicate) {
      alert(`Student ID "${newId}" is already assigned to another student! Please enter a unique ID.`);
      return;
    }

    // Update student ID
    student.id = newId;

    // Update transactions in PAYMENT_LEDGER
    if (typeof PAYMENT_LEDGER !== 'undefined' && Array.isArray(PAYMENT_LEDGER)) {
      PAYMENT_LEDGER.forEach(txn => {
        if (txn.studentId === originalId) {
          txn.studentId = newId;
        }
      });
    }

    // Update global pointers if active
    if (typeof currentViewingStudentId !== 'undefined' && currentViewingStudentId === originalId) {
      currentViewingStudentId = newId;
    }
    if (AppState.selectedSiblingId === originalId) {
      AppState.selectedSiblingId = newId;
    }
  }

  // Update Teacher counts & faculty assignment
  const selectedTeacherId = newTeacherId;
  const matchedTeacher = (AppState.teachers || []).find(t => 
    t.id === selectedTeacherId || 
    (t.id && selectedTeacherId && t.id.toLowerCase() === selectedTeacherId.toLowerCase()) ||
    t.name === selectedTeacherId ||
    (t.name && selectedTeacherId && t.name.toLowerCase() === selectedTeacherId.toLowerCase())
  );

  const prevTeacherId = student.teacherId || '';
  const currentAssignedId = matchedTeacher ? matchedTeacher.id : (selectedTeacherId || '');

  if (prevTeacherId !== currentAssignedId) {
    const oldTeacher = (AppState.teachers || []).find(t => t.id === prevTeacherId || t.name === student.teacherName);
    if (oldTeacher && oldTeacher.activeStudents > 0) {
      oldTeacher.activeStudents--;
      dbSaveTeacher(oldTeacher);
    }
    if (matchedTeacher) {
      matchedTeacher.activeStudents = (matchedTeacher.activeStudents || 0) + 1;
      dbSaveTeacher(matchedTeacher);
    }
  }

  if (matchedTeacher) {
    student.teacherId = matchedTeacher.id;
    student.teacherName = matchedTeacher.name;
    student.assignedTeacher = matchedTeacher.name;
  } else if (!selectedTeacherId || selectedTeacherId === 'Unassigned') {
    student.teacherId = '';
    student.teacherName = 'Unassigned';
    student.assignedTeacher = 'Unassigned';
  } else {
    student.teacherId = selectedTeacherId;
    student.teacherName = selectedTeacherId;
    student.assignedTeacher = selectedTeacherId;
  }

  // Update Fee & Currency
  student.currencyCode = currencyCode;
  student.currency = getCurrencySymbol(currencyCode);
  if (monthlyFee !== student.monthlyFee) {
    student.monthlyFee = monthlyFee;
    if (Array.isArray(student.months)) {
      student.months.forEach(m => {
        if (m.status === 'upcoming' || (m.status === 'defaulter' && m.amountPaid === 0)) {
          m.feeDue = monthlyFee;
          m.remainingDue = monthlyFee;
        }
      });
    }
  }

  // Update Student Profile
  const academicStatus = document.getElementById('edit-schedule-status')?.value || student.academicStatus || 'Active';
  const avatar = document.getElementById('edit-schedule-avatar')?.value?.trim() || student.avatar;
  student.academicStatus = academicStatus;
  if (avatar) student.avatar = avatar;

  student.firstName = firstName;
  student.lastName = lastName;
  student.guardianName = guardianName;
  student.phone = phone;
  student.whatsapp = whatsapp;
  student.email = email;
  student.address = address;
  student.country = newCountry;
  student.timezone = newTimezone;
  student.course = newCourse;
  const rawDuration = document.getElementById('edit-schedule-class-duration')?.value;
  student.classDuration = (rawDuration === '15' || rawDuration === '60') ? Number(rawDuration) : 30;
  student.familyId = familyId;
  student.weeklySchedule = newWeeklySchedule;
  student.classSchedule = getSchedulePillSummary(student);

  saveToStorage('lms_students', AppState.students);
  saveToStorage('lms_teachers', AppState.teachers);
  dbSaveStudent(student);

  closeEditScheduleModal();
  renderApp();

  showToastNotification(`✓ Student record & ID (${student.id}) updated successfully!`);
}

// ==========================================
// PRE-UPLOAD IMAGE CROPPER ENGINE (1:1 CIRCULAR / SQUARE)
// ==========================================

const cropperState = {
  img: null,
  target: 'student', // 'student' or 'teacher'
  zoom: 1,
  rotation: 0,
  panX: 0,
  panY: 0,
  cropRadius: 110, // diameter 220 in 300x300 viewport
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0
};

let cropperEventsBound = false;

function bindCropperCanvasEvents() {
  if (cropperEventsBound) return;
  const canvas = document.getElementById('cropper-canvas');
  if (!canvas) return;

  canvas.addEventListener('mousedown', (e) => {
    cropperState.isDragging = true;
    cropperState.dragStartX = e.clientX - cropperState.panX;
    cropperState.dragStartY = e.clientY - cropperState.panY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!cropperState.isDragging) return;
    cropperState.panX = e.clientX - cropperState.dragStartX;
    cropperState.panY = e.clientY - cropperState.dragStartY;
    renderCropperCanvas();
  });

  window.addEventListener('mouseup', () => {
    cropperState.isDragging = false;
  });

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      cropperState.isDragging = true;
      cropperState.dragStartX = e.touches[0].clientX - cropperState.panX;
      cropperState.dragStartY = e.touches[0].clientY - cropperState.panY;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (!cropperState.isDragging || e.touches.length !== 1) return;
    cropperState.panX = e.touches[0].clientX - cropperState.dragStartX;
    cropperState.panY = e.touches[0].clientY - cropperState.dragStartY;
    renderCropperCanvas();
  }, { passive: true });

  canvas.addEventListener('touchend', () => {
    cropperState.isDragging = false;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    cropperStepZoom(delta);
  }, { passive: false });

  cropperEventsBound = true;
}

function renderCropperCanvas() {
  const canvas = document.getElementById('cropper-canvas');
  if (!canvas || !cropperState.img) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = cropperState.cropRadius;

  ctx.clearRect(0, 0, w, h);

  // Dark backdrop
  ctx.fillStyle = '#0B1514';
  ctx.fillRect(0, 0, w, h);

  // 1. Draw transformed image
  ctx.save();
  ctx.translate(cx + cropperState.panX, cy + cropperState.panY);
  ctx.rotate((cropperState.rotation * Math.PI) / 180);

  const isRotated90 = (cropperState.rotation % 180 !== 0);
  const imgW = isRotated90 ? cropperState.img.height : cropperState.img.width;
  const imgH = isRotated90 ? cropperState.img.width : cropperState.img.height;
  const baseScale = Math.max((r * 2) / imgW, (r * 2) / imgH);
  const currentScale = baseScale * cropperState.zoom;

  ctx.scale(currentScale, currentScale);
  ctx.drawImage(cropperState.img, -cropperState.img.width / 2, -cropperState.img.height / 2);
  ctx.restore();

  // 2. Dark vignette mask outside circle
  ctx.save();
  ctx.fillStyle = 'rgba(11, 21, 20, 0.72)';
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.restore();

  // 3. Crisp Dashed Circular Guide Ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#FFFFFF';
  ctx.setLineDash([5, 4]);
  ctx.stroke();

  // Rule of thirds subtle grid
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(cx - r / 3, cy - r);
  ctx.lineTo(cx - r / 3, cy + r);
  ctx.moveTo(cx + r / 3, cy - r);
  ctx.lineTo(cx + r / 3, cy + r);
  ctx.moveTo(cx - r, cy - r / 3);
  ctx.lineTo(cx + r, cy - r / 3);
  ctx.moveTo(cx - r, cy + r / 3);
  ctx.lineTo(cx + r, cy + r / 3);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

function openImageCropper(dataUrl, target) {
  const modal = document.getElementById('image-cropper-modal');
  if (!modal) return;

  const img = new Image();
  img.onload = function() {
    cropperState.img = img;
    cropperState.target = target;
    cropperState.zoom = 1;
    cropperState.rotation = 0;
    cropperState.panX = 0;
    cropperState.panY = 0;

    const slider = document.getElementById('cropper-zoom-slider');
    if (slider) slider.value = '1';
    const zoomLevel = document.getElementById('cropper-zoom-level');
    if (zoomLevel) zoomLevel.textContent = '1.0x';

    modal.classList.add('active');
    bindCropperCanvasEvents();
    renderCropperCanvas();
  };
  img.src = dataUrl;
}

function closeImageCropper() {
  const modal = document.getElementById('image-cropper-modal');
  if (modal) modal.classList.remove('active');
  cropperState.img = null;
  cropperState.isDragging = false;
}

function cropperSetZoom(val) {
  cropperState.zoom = Math.min(3, Math.max(1, val));
  const slider = document.getElementById('cropper-zoom-slider');
  if (slider && parseFloat(slider.value) !== cropperState.zoom) {
    slider.value = cropperState.zoom.toString();
  }
  const zoomLevel = document.getElementById('cropper-zoom-level');
  if (zoomLevel) zoomLevel.textContent = `${cropperState.zoom.toFixed(1)}x`;
  renderCropperCanvas();
}

function cropperStepZoom(delta) {
  cropperSetZoom(cropperState.zoom + delta);
}

function cropperRotate() {
  cropperState.rotation = (cropperState.rotation + 90) % 360;
  renderCropperCanvas();
}

function cropperReset() {
  cropperState.panX = 0;
  cropperState.panY = 0;
  cropperState.rotation = 0;
  cropperSetZoom(1);
}

function applyImageCrop() {
  if (!cropperState.img) return;

  const outCanvas = document.createElement('canvas');
  const outSize = 360;
  outCanvas.width = outSize;
  outCanvas.height = outSize;
  const outCtx = outCanvas.getContext('2d');

  const r = cropperState.cropRadius;
  const ratio = (outSize / 2) / r;

  const isRotated90 = (cropperState.rotation % 180 !== 0);
  const imgW = isRotated90 ? cropperState.img.height : cropperState.img.width;
  const imgH = isRotated90 ? cropperState.img.width : cropperState.img.height;
  const baseScale = Math.max((r * 2) / imgW, (r * 2) / imgH);
  const currentScale = baseScale * cropperState.zoom;

  outCtx.save();
  outCtx.translate(outSize / 2, outSize / 2);
  outCtx.translate(cropperState.panX * ratio, cropperState.panY * ratio);
  outCtx.rotate((cropperState.rotation * Math.PI) / 180);
  outCtx.scale(currentScale * ratio, currentScale * ratio);
  outCtx.drawImage(cropperState.img, -cropperState.img.width / 2, -cropperState.img.height / 2);
  outCtx.restore();

  const croppedDataUrl = outCanvas.toDataURL('image/jpeg', 0.92);

  if (cropperState.target === 'student') {
    updateStudentPhotoUI(croppedDataUrl);
  } else if (cropperState.target === 'teacher') {
    updateTeacherPhotoUI(croppedDataUrl);
  }

  closeImageCropper();
  showToastNotification('✓ Photo cropped and attached successfully!');
}

// ==========================================
// ADD STUDENT MODAL CONTROLLERS
// ==========================================

function openAddStudentModal() {
  const modal = document.getElementById('add-student-modal');
  if (!modal) return;

  const idInput = document.getElementById('add-student-id');
  if (idInput) {
    idInput.value = '';
    idInput.disabled = false;
    idInput.readOnly = false;
  }

  const fullNameInput = document.getElementById('add-student-full-name');
  if (fullNameInput) fullNameInput.value = '';

  const guardianInput = document.getElementById('add-student-guardian-name');
  if (guardianInput) guardianInput.value = '';

  const whatsappInput = document.getElementById('add-student-whatsapp');
  if (whatsappInput) whatsappInput.value = '';

  const emailInput = document.getElementById('add-student-email');
  if (emailInput) emailInput.value = '';

  // Country & Timezone - neutral blank selection
  const countrySelect = document.getElementById('add-student-country');
  if (countrySelect) {
    populateCountryOptions(countrySelect, '');
    countrySelect.value = '';
  }
  const tzInput = document.getElementById('add-student-timezone');
  if (tzInput) tzInput.value = '';

  const addressInput = document.getElementById('add-student-address');
  if (addressInput) addressInput.value = '';

  // Family ID Tag - populate datalist with existing families, but keep input empty
  const familyDatalist = document.getElementById('family-id-datalist');
  const familyInput = document.getElementById('add-student-family-id');
  const familyMap = {};
  (AppState.students || []).forEach(s => {
    if (s.familyId && !familyMap[s.familyId]) {
      familyMap[s.familyId] = s.guardianName || s.lastName || 'Family';
    }
  });
  if (familyDatalist) {
    const options = Object.keys(familyMap).map(fId => `<option value="${fId}">${fId} (${familyMap[fId]})</option>`);
    familyDatalist.innerHTML = options.join('');
  }
  if (familyInput) {
    familyInput.value = '';
  }

  // Course / Track - neutral blank selection
  const courseSelect = document.getElementById('add-student-course');
  if (courseSelect) courseSelect.value = '';

  // Assigned Faculty / Teacher - populate dropdown
  const teacherSelect = document.getElementById('add-student-teacher');
  if (teacherSelect) {
    teacherSelect.innerHTML = `<option value="" disabled selected>Select Faculty / Teacher</option>` +
      (AppState.teachers || []).map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  }

  // Currency - neutral blank selection
  const currencySelect = document.getElementById('add-student-currency');
  if (currencySelect) currencySelect.value = '';

  // Monthly Fee - empty
  const feeInput = document.getElementById('add-student-fee');
  if (feeInput) feeInput.value = '';

  // Class Duration - default from academy settings (30 min) when supported
  const durationSelect = document.getElementById('add-student-class-duration');
  if (durationSelect) {
    const globalDuration = Number(AppState.settings && AppState.settings.classDuration);
    durationSelect.value = (globalDuration === 15 || globalDuration === 30 || globalDuration === 60) ? String(globalDuration) : '30';
  }

  // Completely blank photo preview reset (no dummy faces)
  const photoPlaceholder = document.getElementById('add-student-photo-placeholder');
  const photoPreview = document.getElementById('add-student-photo-preview');
  const photoInput = document.getElementById('add-student-avatar');
  const photoFile = document.getElementById('add-student-photo-file');
  const photoLabel = document.getElementById('add-student-photo-label');
  const photoBadge = document.getElementById('add-student-photo-badge');

  if (photoFile) photoFile.value = '';
  if (photoInput) photoInput.value = '';
  if (photoPreview) {
    photoPreview.src = '';
    photoPreview.classList.add('hidden');
  }
  if (photoPlaceholder) photoPlaceholder.classList.remove('hidden');
  if (photoLabel) photoLabel.textContent = 'Click or drag image to upload official photo';
  if (photoBadge) {
    photoBadge.textContent = 'Upload Photo';
    photoBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white text-[#7A8684] border border-[#ECEAE4]';
  }

  clearAllFormErrors('add-student-modal');
  initFormDraftAutoSave('add-student-modal', 'new_student', [
    'add-student-id', 'add-student-full-name', 'add-student-guardian-name',
    'add-student-whatsapp', 'add-student-email', 'add-student-country',
    'add-student-timezone', 'add-student-family-id', 'add-student-course',
    'add-student-currency', 'add-student-fee',
    'add-student-class-duration'
  ]);
  restoreFormDraft('add-student-modal', 'new_student', [
    'add-student-id', 'add-student-full-name', 'add-student-guardian-name',
    'add-student-whatsapp', 'add-student-email', 'add-student-country',
    'add-student-timezone', 'add-student-family-id', 'add-student-course',
    'add-student-currency', 'add-student-fee',
    'add-student-class-duration'
  ]);

  // Family Package: a restored draft family tag must show the package
  // note and pre-fill the share, same as typing the tag by hand.
  handleAddStudentFamilyTagChange();

  modal.classList.add('active');
}

function closeAddStudentModal() {
  const modal = document.getElementById('add-student-modal');
  if (modal) modal.classList.remove('active');
}
window.openAddStudentModal = openAddStudentModal;
window.closeAddStudentModal = closeAddStudentModal;

function handleStudentCountryChange(country) {
  const tzInput = document.getElementById('add-student-timezone');
  if (!tzInput) return;
  if (!country) {
    return;
  }
  // Bug 5 fix: Do not auto-overwrite if timezone was already entered by user
  if (!tzInput.value || !tzInput.value.trim()) {
    const newTz = COUNTRY_TIMEZONE_MAP[country] || 'GMT+0';
    tzInput.value = newTz;
  }
}

function autoFillTimezone(country) {
  handleStudentCountryChange(country);
}

function updateStudentPhotoUI(dataUrl) {
  const placeholder = document.getElementById('add-student-photo-placeholder');
  const preview = document.getElementById('add-student-photo-preview');
  const input = document.getElementById('add-student-avatar');
  const label = document.getElementById('add-student-photo-label');
  const badge = document.getElementById('add-student-photo-badge');

  if (placeholder) placeholder.classList.add('hidden');
  if (preview) {
    preview.src = dataUrl;
    preview.classList.remove('hidden');
  }
  if (input) input.value = dataUrl;
  if (label) label.textContent = 'Photo attached successfully (click to change)';
  if (badge) {
    badge.textContent = 'Attached ✓';
    badge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#E8EFEE] text-[#0E4D45] border border-[#0E4D45]/20';
  }
}

function updateTeacherPhotoUI(dataUrl) {
  const placeholder = document.getElementById('add-teacher-photo-placeholder');
  const preview = document.getElementById('add-teacher-photo-preview');
  const input = document.getElementById('add-teacher-avatar');
  const label = document.getElementById('add-teacher-photo-label');
  const badge = document.getElementById('add-teacher-photo-badge');

  if (placeholder) placeholder.classList.add('hidden');
  if (preview) {
    preview.src = dataUrl;
    preview.classList.remove('hidden');
  }
  if (input) input.value = dataUrl;
  if (label) label.textContent = 'Photo attached successfully (click to change)';
  if (badge) {
    badge.textContent = 'Attached ✓';
    badge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#E8EFEE] text-[#0E4D45] border border-[#0E4D45]/20';
  }
}

function handleStudentPhotoSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    openImageCropper(e.target.result, 'student');
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function handleTeacherPhotoSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    openImageCropper(e.target.result, 'teacher');
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function handlePhotoDrop(event, type) {
  event.preventDefault();
  event.stopPropagation();
  const file = event.dataTransfer?.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    openImageCropper(e.target.result, type);
  };
  reader.readAsDataURL(file);
}

async function handleSaveNewStudent() {
  const studentId = document.getElementById('add-student-id')?.value?.trim();
  const fullName = document.getElementById('add-student-full-name')?.value?.trim();
  const guardianName = document.getElementById('add-student-guardian-name')?.value?.trim();
  const whatsapp = document.getElementById('add-student-whatsapp')?.value?.trim();
  const email = document.getElementById('add-student-email')?.value?.trim();
  const country = document.getElementById('add-student-country')?.value;
  const timezone = document.getElementById('add-student-timezone')?.value?.trim();
  const familyId = document.getElementById('add-student-family-id')?.value?.trim();
  const course = document.getElementById('add-student-course')?.value;
  const currencyCode = document.getElementById('add-student-currency')?.value;
  const rawFee = document.getElementById('add-student-fee')?.value;
  const monthlyFee = Number(rawFee);
  const rawDuration = document.getElementById('add-student-class-duration')?.value;
  const classDuration = (rawDuration === '15' || rawDuration === '60') ? Number(rawDuration) : 30;

  clearAllFormErrors('add-student-modal');

  const validationRules = [
    { id: 'add-student-id', required: true, label: 'Student ID', customValidator: (val) => {
      if (AppState.students.some(s => s.id.toLowerCase() === val.toLowerCase())) {
        return `Student ID "${val}" already exists! Choose a unique ID.`;
      }
      return null;
    }},
    { id: 'add-student-full-name', required: true, minLength: 2, label: 'Student Full Name' },
    { id: 'add-student-guardian-name', required: true, minLength: 2, label: 'Father / Guardian Name' },
    { id: 'add-student-whatsapp', required: true, minLength: 7, label: 'WhatsApp Number' },
    { id: 'add-student-email', required: true, label: 'Email Address' },
    { id: 'add-student-country', required: true, label: 'Country' },
    { id: 'add-student-timezone', required: true, label: 'Timezone' },
    { id: 'add-student-family-id', required: true, label: 'Family ID Tag' },
    { id: 'add-student-course', required: true, label: 'Course / Track' },
    { id: 'add-student-currency', required: true, label: 'Currency' },
    { id: 'add-student-fee', required: true, minNumber: 0.01, label: 'Monthly Fee' } // 0.01: Family Package shares can be below $1 (e.g. $50 / 6 children)
  ];

  if (!validateSharedForm(validationRules)) {
    return;
  }

  const nameParts = fullName.split(' ');
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ') || '';

  const currency = getCurrencySymbol(currencyCode);

  const defaultWeeklySchedule = {
    mon: { active: true, time: '10:00 AM - 10:45 AM' },
    tue: { active: false, time: '' },
    wed: { active: true, time: '10:00 AM - 10:45 AM' },
    thu: { active: false, time: '' },
    fri: { active: true, time: '10:00 AM - 10:45 AM' },
    sat: { active: false, time: '' },
    sun: { active: false, time: '' }
  };
  const classSchedule = getSchedulePillSummary({ weeklySchedule: defaultWeeklySchedule, timezone });

  const currentEnrollMonth = CURRENT_MONTH_INDEX;
  const months = MONTHS_LIST.map((m, idx) => ({
    month: m,
    status: idx < currentEnrollMonth ? 'not_enrolled' : (idx > CURRENT_MONTH_INDEX ? 'upcoming' : 'defaulter'),
    feeDue: idx < currentEnrollMonth ? 0 : monthlyFee,
    amountPaid: 0,
    remainingDue: idx < currentEnrollMonth ? 0 : monthlyFee
  }));

  const customAvatar = document.getElementById('add-student-avatar')?.value?.trim();
  const avatar = customAvatar || getAvatarUrl(fullName);
  const addressVal = document.getElementById('add-student-address')?.value?.trim();
  const address = addressVal || '';

  const selectedTeacherId = document.getElementById('add-student-teacher')?.value;
  const teacherId = selectedTeacherId || ((AppState.teachers && AppState.teachers.length > 0) ? AppState.teachers[0].id : 'T-UNASSIGNED');
  const teacherObj = (AppState.teachers || []).find(t => 
    String(t.id).trim().toLowerCase() === String(teacherId).trim().toLowerCase() ||
    String(t.name).trim().toLowerCase() === String(teacherId).trim().toLowerCase()
  );
  const teacherName = teacherObj ? teacherObj.name : 'Unassigned';

  const newStudent = {
    id: studentId,
    firstName: firstName,
    lastName: lastName,
    academicStatus: 'Active',
    avatar: avatar,
    guardianName: guardianName,
    phone: whatsapp,
    whatsapp: whatsapp,
    email: email,
    address: address,
    country: country,
    timezone: timezone,
    familyId: familyId,
    familyTag: familyId,
    teacherId: teacherObj ? teacherObj.id : teacherId,
    teacherName: teacherName,
    assignedTeacher: teacherName,
    course: course,
    classDuration: classDuration,
    weeklySchedule: defaultWeeklySchedule,
    classSchedule: classSchedule,
    currency: currency,
    currencyCode: currencyCode,
    monthlyFee: monthlyFee,
    enrollmentDate: new Date().toISOString().split('T')[0],
    months: months,
    lastSabaq: {
      date: new Date().toISOString().split('T')[0],
      type: 'Initial Enrollment',
      surah: 'Surah Al-Fatiha',
      status: 'Enrolled',
      rating: 5,
      tags: ['MashaAllah Good'],
      teacherNote: 'New student orientation and baseline assessment.'
    }
  };

  AppState.students.unshift(newStudent);

  if (teacherObj) {
    teacherObj.activeStudents = (teacherObj.activeStudents || 0) + 1;
  }

  saveToStorage('lms_students', AppState.students);
  saveToStorage('lms_teachers', AppState.teachers);
  // Await the cloud save and tell the truth: the success toast shows ONLY
  // when Firestore confirms the write. A cloud failure leaves the record
  // saved on this device only, and the user must know that.
  const cloudSaved = await dbSaveStudent(newStudent);
  let teacherCloudSaved = true;
  if (teacherObj) teacherCloudSaved = await dbSaveTeacher(teacherObj);

  // Family Package: if this family pays one flat fee for all children,
  // fold the new member in and re-split the package equally across all
  // members (existing members' shares update too).
  let packageCloudSaved = true;
  const existingPkgFee = getFamilyPackage(familyId);
  if (existingPkgFee) {
    newStudent.familyPackage = true;
    newStudent.familyPackageFee = existingPkgFee;
    newStudent.prePackageFee = monthlyFee;
    // Package fee raised at enrolment: if the admin entered a different
    // flat fee in the form, apply it to every member (including the new
    // student) before the re-split, so shares use the new fee. An empty,
    // invalid, zero or unchanged value is ignored and the package stays
    // exactly as it is.
    const pkgRaiseInput = document.getElementById('add-student-package-fee');
    const raisedFee = pkgRaiseInput ? Number(pkgRaiseInput.value) : NaN;
    if (!isNaN(raisedFee) && raisedFee > 0 && raisedFee !== existingPkgFee) {
      getFamilyMembers(familyId).forEach(s => { s.familyPackageFee = raisedFee; });
      newStudent.familyPackageFee = raisedFee;
    }
    packageCloudSaved = await recalcFamilyPackage(familyId);
  }

  addSystemNotification({
    title: 'Student Enrolled',
    desc: `Enrolled ${firstName} ${lastName} (${studentId}) in ${course} with faculty ${teacherName} (${currency}${newStudent.monthlyFee}/mo).`,
    type: 'student'
  });

  closeAddStudentModal();
  renderApp();
  if (cloudSaved && teacherCloudSaved && packageCloudSaved) {
    showToastNotification(`✓ Student ${fullName} (${studentId}) successfully enrolled and registered!`);
  } else {
    showToastNotification(`Could not save to cloud: ${firestoreSyncError || 'Firestore is not available'} — saved on this device only.`, 'error');
  }
}

function openAddTeacherModal() {
  const modal = document.getElementById('add-teacher-modal');
  if (!modal) return;

  const idInput = document.getElementById('add-teacher-id');
  if (idInput) {
    idInput.value = '';
    idInput.disabled = false;
    idInput.readOnly = false;
  }

  const nameInput = document.getElementById('add-teacher-name');
  if (nameInput) nameInput.value = '';

  const fatherInput = document.getElementById('add-teacher-father-name');
  if (fatherInput) fatherInput.value = '';

  const cnicInput = document.getElementById('add-teacher-cnic');
  if (cnicInput) cnicInput.value = '';

  const emailInput = document.getElementById('add-teacher-email');
  if (emailInput) emailInput.value = '';

  const phoneInput = document.getElementById('add-teacher-phone');
  if (phoneInput) phoneInput.value = '';


  // Completely blank photo preview reset (no dummy faces)
  const photoPlaceholder = document.getElementById('add-teacher-photo-placeholder');
  const photoPreview = document.getElementById('add-teacher-photo-preview');
  const photoInput = document.getElementById('add-teacher-avatar');
  const photoFile = document.getElementById('add-teacher-photo-file');
  const photoLabel = document.getElementById('add-teacher-photo-label');
  const photoBadge = document.getElementById('add-teacher-photo-badge');

  if (photoFile) photoFile.value = '';
  if (photoInput) photoInput.value = '';
  if (photoPreview) {
    photoPreview.src = '';
    photoPreview.classList.add('hidden');
  }
  if (photoPlaceholder) photoPlaceholder.classList.remove('hidden');
  if (photoLabel) photoLabel.textContent = 'Click or drag image to upload teacher photo';
  if (photoBadge) {
    photoBadge.textContent = 'Upload Photo';
    photoBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white text-[#7A8684] border border-[#ECEAE4]';
  }

  clearAllFormErrors('add-teacher-modal');
  initFormDraftAutoSave('add-teacher-modal', 'new_teacher', [
    'add-teacher-id', 'add-teacher-name', 'add-teacher-father-name',
    'add-teacher-cnic', 'add-teacher-email', 'add-teacher-phone'
  ]);
  restoreFormDraft('add-teacher-modal', 'new_teacher', [
    'add-teacher-id', 'add-teacher-name', 'add-teacher-father-name',
    'add-teacher-cnic', 'add-teacher-email', 'add-teacher-phone'
  ]);


  modal.classList.add('active');
}

function closeAddTeacherModal() {
  const modal = document.getElementById('add-teacher-modal');
  if (modal) modal.classList.remove('active');
}
window.openAddTeacherModal = openAddTeacherModal;
window.closeAddTeacherModal = closeAddTeacherModal;

async function handleSaveNewTeacher() {
  const teacherId = document.getElementById('add-teacher-id')?.value?.trim();
  const name = document.getElementById('add-teacher-name')?.value?.trim();
  const fatherName = document.getElementById('add-teacher-father-name')?.value?.trim();
  const cnic = document.getElementById('add-teacher-cnic')?.value?.trim();
  const email = document.getElementById('add-teacher-email')?.value?.trim();
  const phone = document.getElementById('add-teacher-phone')?.value?.trim();

  clearAllFormErrors('add-teacher-modal');

  const validationRules = [
    { id: 'add-teacher-id', required: true, label: 'Teacher ID', customValidator: (val) => {
      if (AppState.teachers.some(t => t.id.toLowerCase() === val.toLowerCase())) {
        return `Teacher ID "${val}" already exists! Please choose a unique ID.`;
      }
      return null;
    }},
    { id: 'add-teacher-name', required: true, minLength: 2, label: 'Teacher Full Name' },
    { id: 'add-teacher-father-name', required: true, label: 'Father Name' },
    { id: 'add-teacher-cnic', required: true, minLength: 5, label: 'CNIC (National ID)' },
    { id: 'add-teacher-email', required: true, label: 'Gmail / Email Address' },
    { id: 'add-teacher-phone', required: true, minLength: 7, label: 'WhatsApp Number' },
  ];

  if (!validateSharedForm(validationRules)) {
    return;
  }

  const isHafiz = Boolean(document.getElementById('add-teacher-is-hafiz')?.checked);
  const customAvatar = document.getElementById('add-teacher-avatar')?.value?.trim();
  const avatar = customAvatar || getAvatarUrl(name);

  const newTeacher = {
    id: teacherId,
    name: name,
    fatherName: fatherName,
    cnic: cnic,
    country: 'Pakistan',
    isHafiz: isHafiz,
    activeStudents: 0,
    rating: 5.0,
    status: 'Available',
    salaryStatus: 'Pending',
    phone: phone,
    whatsapp: phone,
    email: email,
    avatar: avatar
  };

  AppState.teachers.push(newTeacher);
  saveToStorage('lms_teachers', AppState.teachers);
  // Await the cloud save and tell the truth: the success toast shows ONLY
  // when Firestore confirms the write. A cloud failure leaves the record
  // saved on this device only, and the user must know that.
  const cloudSaved = await dbSaveTeacher(newTeacher);

  addSystemNotification({
    title: 'Faculty Onboarded',
    desc: `Added faculty member ${name} (${teacherId}).`,
    type: 'teacher'
  });

  clearFormDraft('new_teacher');
  closeAddTeacherModal();
  renderApp();
  if (cloudSaved) {
    showToastNotification(`✓ Teacher ${name} (${teacherId}) successfully added to Academy faculty!`);
  } else {
    showToastNotification(`Could not save to cloud: ${firestoreSyncError || 'Firestore is not available'} — saved on this device only.`, 'error');
  }
}

// ==========================================
// EDIT TEACHER
// Mirrors the Edit Student flow (edit-schedule modal): the modal is
// pre-filled with the teacher's current values, Teacher ID is shown but
// never editable (it links students to this teacher), and saving updates
// AppState, localStorage AND Firestore — with the success toast shown
// only when Firestore confirms the write (see b9b20fe).
// ==========================================

// One-time data repair: Qari Abdul Basit and Qari Saad Ahmed were saved
// with country "Pakistan" although they are based in the United Kingdom /
// United Arab Emirates. Matches by name (live ids differ between the
// seed TCH-101/TCH-103 and later adds), corrects the record in AppState,
// local cache AND Firestore, and only when the country is still
// "Pakistan" — so it never runs twice and never touches any other teacher.
const TEACHER_COUNTRY_REPAIRS = [
  { name: 'Qari Abdul Basit', country: 'United Kingdom' },
  { name: 'Qari Saad Ahmed', country: 'United Arab Emirates' }
];

async function repairTeacherCountries() {
  let repaired = false;
  for (const fix of TEACHER_COUNTRY_REPAIRS) {
    const teacher = (AppState.teachers || []).find(t =>
      t && t.name && String(t.name).trim().toLowerCase() === fix.name.toLowerCase() &&
      t.country && String(t.country).trim().toLowerCase() === 'pakistan'
    );
    if (!teacher) continue;
    teacher.country = fix.country;
    repaired = true;
    console.log(`[Repair] Corrected country for ${teacher.name} (${teacher.id}) to ${fix.country}.`);
  }
  if (!repaired) return false;
  saveToStorage('lms_teachers', AppState.teachers);
  for (const fix of TEACHER_COUNTRY_REPAIRS) {
    const teacher = (AppState.teachers || []).find(t =>
      t && t.name && String(t.name).trim().toLowerCase() === fix.name.toLowerCase() &&
      t.country === fix.country
    );
    if (teacher) await dbSaveTeacher(teacher);
  }
  renderApp();
  return true;
}
window.repairTeacherCountries = repairTeacherCountries;

function openEditTeacherModal(teacherId) {
  const modal = document.getElementById('edit-teacher-modal');
  if (!modal) return;
  const teacher = (AppState.teachers || []).find(t =>
    t.id === teacherId ||
    String(t.id).trim().toLowerCase() === String(teacherId).trim().toLowerCase()
  );
  if (!teacher) return;

  const originalIdInput = document.getElementById('edit-teacher-original-id');
  if (originalIdInput) originalIdInput.value = teacher.id;

  const idBadge = document.getElementById('edit-teacher-id-badge');
  if (idBadge) idBadge.textContent = `ID: ${teacher.id}`;

  const idInput = document.getElementById('edit-teacher-id');
  if (idInput) idInput.value = teacher.id;

  const nameInput = document.getElementById('edit-teacher-name');
  if (nameInput) nameInput.value = teacher.name || '';

  const fatherInput = document.getElementById('edit-teacher-father-name');
  if (fatherInput) fatherInput.value = teacher.fatherName || '';

  const cnicInput = document.getElementById('edit-teacher-cnic');
  if (cnicInput) cnicInput.value = teacher.cnic || '';

  const emailInput = document.getElementById('edit-teacher-email');
  if (emailInput) emailInput.value = teacher.email || '';

  const phoneInput = document.getElementById('edit-teacher-phone');
  if (phoneInput) phoneInput.value = teacher.phone || teacher.whatsapp || '';

  clearAllFormErrors('edit-teacher-modal');
  modal.classList.add('active');
}

function closeEditTeacherModal() {
  const modal = document.getElementById('edit-teacher-modal');
  if (modal) modal.classList.remove('active');
}
window.openEditTeacherModal = openEditTeacherModal;
window.closeEditTeacherModal = closeEditTeacherModal;

async function handleSaveEditTeacher() {
  const originalId = document.getElementById('edit-teacher-original-id')?.value;
  const teacher = (AppState.teachers || []).find(t => t.id === originalId);
  if (!teacher) return;

  const name = document.getElementById('edit-teacher-name')?.value?.trim();
  const fatherName = document.getElementById('edit-teacher-father-name')?.value?.trim();
  const cnic = document.getElementById('edit-teacher-cnic')?.value?.trim();
  const email = document.getElementById('edit-teacher-email')?.value?.trim();
  const phone = document.getElementById('edit-teacher-phone')?.value?.trim();

  clearAllFormErrors('edit-teacher-modal');

  // Same validation as Add Teacher, minus Teacher ID (not editable).
  const validationRules = [
    { id: 'edit-teacher-name', required: true, minLength: 2, label: 'Teacher Full Name' },
    { id: 'edit-teacher-father-name', required: true, label: 'Father Name' },
    { id: 'edit-teacher-cnic', required: true, minLength: 5, label: 'CNIC (National ID)' },
    { id: 'edit-teacher-email', required: true, label: 'Gmail / Email Address' },
    { id: 'edit-teacher-phone', required: true, minLength: 7, label: 'WhatsApp Number' },
  ];

  if (!validateSharedForm(validationRules)) {
    return;
  }

  const oldName = teacher.name;

  teacher.name = name;
  teacher.fatherName = fatherName;
  teacher.cnic = cnic;
  teacher.email = email;
  teacher.phone = phone;
  teacher.whatsapp = phone;
  // Keep avatar initials in step with the name (only for generated
  // avatars — a custom uploaded photo is left alone).
  if (name !== oldName && (!teacher.avatar || String(teacher.avatar).includes('ui-avatars.com'))) {
    teacher.avatar = getAvatarUrl(name);
  }

  // Student assignments stay intact (teacherId never changes), but the
  // display name stored on each assigned student must follow a rename.
  if (name !== oldName) {
    const assignedStudents = (AppState.students || []).filter(s => s.teacherId === teacher.id);
    assignedStudents.forEach(s => {
      s.teacherName = name;
      s.assignedTeacher = name;
      dbSaveStudent(s);
    });
    if (assignedStudents.length > 0) {
      saveToStorage('lms_students', AppState.students);
    }
  }

  saveToStorage('lms_teachers', AppState.teachers);
  // Await the cloud save and tell the truth: the success toast shows ONLY
  // when Firestore confirms the write.
  const cloudSaved = await dbSaveTeacher(teacher);

  addSystemNotification({
    title: 'Faculty Updated',
    desc: `Updated faculty member ${name} (${teacher.id}).`,
    type: 'teacher'
  });

  closeEditTeacherModal();
  renderApp();
  if (cloudSaved) {
    showToastNotification(`✓ Teacher ${name} (${teacher.id}) updated successfully!`);
  } else {
    showToastNotification(`Could not save to cloud: ${firestoreSyncError || 'Firestore is not available'} — saved on this device only.`, 'error');
  }
}
window.handleSaveEditTeacher = handleSaveEditTeacher;

// ==========================================
// TEACHER PAYROLL & SALARY ACTIONS
// ==========================================

let pendingDeleteCallback = null;

function openDeleteConfirmationModal({ title, message, onConfirm }) {
  // If native confirm is explicitly forced by tests or overridden by test suites
  if (window.__useNativeConfirm || (typeof window.confirm === 'function' && window.confirm.toString().indexOf('[native code]') === -1)) {
    if (window.confirm(message)) {
      if (typeof onConfirm === 'function') onConfirm();
    }
    return;
  }

  const modal = document.getElementById('delete-confirmation-modal');
  if (modal) {
    const titleEl = document.getElementById('delete-modal-title');
    const msgEl = document.getElementById('delete-modal-message');
    const confirmBtn = document.getElementById('delete-modal-confirm-btn');
    if (titleEl) titleEl.textContent = title || 'Confirm Deletion';
    if (msgEl) msgEl.textContent = message || 'Are you sure you want to delete this record?';
    pendingDeleteCallback = onConfirm;
    if (confirmBtn) {
      confirmBtn.onclick = async function (e) {
        if (e) {
          e.stopPropagation();
          if (typeof e.preventDefault === 'function') e.preventDefault();
        }
        const cb = pendingDeleteCallback;
        pendingDeleteCallback = null;
        closeDeleteConfirmationModal();
        if (typeof cb === 'function') {
          try {
            await cb();
          } catch (err) {
            console.error('[Delete Error]', err);
          }
        }
      };
    }
    modal.classList.add('active');
  } else {
    if (window.confirm(message)) {
      if (typeof onConfirm === 'function') onConfirm();
    }
  }
}

function closeDeleteConfirmationModal() {
  pendingDeleteCallback = null;
  const modal = document.getElementById('delete-confirmation-modal');
  if (modal) modal.classList.remove('active');
}
window.openDeleteConfirmationModal = openDeleteConfirmationModal;
window.closeDeleteConfirmationModal = closeDeleteConfirmationModal;

function deleteTeacher(teacherId, event) {
  if (event) {
    event.stopPropagation();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
  const teacher = (AppState.teachers || []).find(t => 
    t.id === teacherId || 
    String(t.id).trim().toLowerCase() === String(teacherId).trim().toLowerCase()
  );
  if (!teacher) return;

  const msg = `Are you sure you want to delete teacher "${teacher.name}" (${teacher.id})? This will remove them from the faculty roster and set assigned students to Unassigned.`;
  openDeleteConfirmationModal({
    title: 'Delete Faculty Member',
    message: msg,
    onConfirm: async () => {
      const success = await dbDeleteTeacher(teacher.id);
      if (success) {
        addSystemNotification({
          title: 'Faculty Member Removed',
          desc: `Permanently deleted faculty record "${teacher.name}" (${teacher.id}).`,
          type: 'teacher'
        });
        showToastNotification(`✓ Teacher "${teacher.name}" deleted successfully.`);
      }
    }
  });
}
window.deleteTeacher = deleteTeacher;

// toggleTeacherSalaryStatus now lives in section 8A0 (PKR payroll) above
// renderAdminTeacherPayrollView, with per-month Paid snapshots.

const debouncedTeacherPayrollSearch = debounce(function(q) {
  AppState.teacherPayrollSearchQuery = q;
  renderApp();
}, 200);

function handleTeacherPayrollSearch(q) {
  debouncedTeacherPayrollSearch(q);
}
window.handleTeacherPayrollSearch = handleTeacherPayrollSearch;

function clearTeacherPayrollSearch() {
  AppState.teacherPayrollSearchQuery = '';
  renderApp();
}
window.clearTeacherPayrollSearch = clearTeacherPayrollSearch;

function setTeacherPayrollHafizFilter(val) {
  // Hafiz filter removed: all teachers are shown as Teachers
}
window.setTeacherPayrollHafizFilter = setTeacherPayrollHafizFilter;

function setTeacherPayrollSalaryFilter(val) {
  AppState.teacherPayrollSalaryFilter = val;
  renderApp();
}
window.setTeacherPayrollSalaryFilter = setTeacherPayrollSalaryFilter;

function setTeacherPayrollSpecializationFilter(val) {
  // Specialization filter removed: all teachers teach all courses
}
window.setTeacherPayrollSpecializationFilter = setTeacherPayrollSpecializationFilter;

function resetTeacherPayrollFilters() {
  AppState.teacherPayrollSalaryFilter = 'all';
  AppState.teacherPayrollSpecializationFilter = 'all';
  AppState.teacherPayrollSearchQuery = '';
  renderApp();
}
window.resetTeacherPayrollFilters = resetTeacherPayrollFilters;

// ==========================================
// WHATSAPP FEE REMINDER DISPATCH
// ==========================================

function openWhatsAppFeeReminder(studentId) {
  const student = AppState.students.find(s => s.id === studentId);
  if (!student) return;
  const balanceDue = getStudentBalanceDue(student);
  const cleanPhone = (student.whatsapp || student.phone || '').replace(/[^0-9]/g, '');
  const parentName = student.guardianName || 'Parent';
  const message = `Assalam-o-Alaikum ${parentName}, this is an official fee reminder from Quranic Skills Academy regarding ${student.firstName} (${student.id}). The pending tuition balance is ${student.currency}${balanceDue} for academic session ${MONTHS_LIST[CURRENT_MONTH_INDEX]} ${CURRENT_YEAR}. Please settle via student portal or bank transfer. JazakAllah Khair!`;
  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
  showToastNotification(`✓ Opening WhatsApp reminder for ${student.firstName} (${student.currency}${balanceDue} due)`);
}

// ==========================================
// TRIAL CONVERSION & NOTICE BROADCAST
// ==========================================

function approveTrialToStudent(trialId) {
  const trialIndex = TRIAL_PIPELINE.findIndex(t => t.id === trialId);
  if (trialIndex === -1) return;
  const trial = TRIAL_PIPELINE[trialIndex];

  const newId = 'QA-' + (1080 + AppState.students.length);
  const nameParts = trial.studentName.trim().split(' ');
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ') || 'Candidate';

  const newStudent = {
    id: newId,
    firstName: firstName,
    lastName: lastName,
    avatar: trial.avatar || 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=120&h=120&fit=crop&crop=faces',
    guardianName: trial.studentName + ' Guardian',
    phone: '+44 7911 123456',
    whatsapp: '+447911123456',
    email: `${firstName.toLowerCase()}@guardian.com`,
    address: 'Residential Address, ' + trial.country,
    country: trial.country.split(' ')[0] || 'UK',
    timezone: trial.preferredTime.includes('CST') ? 'GMT-5 (CST)' : (trial.preferredTime.includes('BST') ? 'GMT+1 (BST)' : 'GMT+10 (AEST)'),
    familyId: 'FAM-' + (125 + AppState.students.length),
    teacherId: AppState.teachers.find(t => t.name === trial.assignedTeacher)?.id || AppState.teachers[0]?.id || 'T-UNASSIGNED',
    teacherName: trial.assignedTeacher || AppState.teachers[0]?.name || 'Unassigned',
    assignedTeacher: trial.assignedTeacher || AppState.teachers[0]?.name || 'Unassigned',
    course: 'Qaida for Beginners',
    currency: '$',
    currencyCode: 'USD',
    monthlyFee: 50,
    enrollmentDate: new Date().toISOString().split('T')[0],
    months: MONTHS_LIST.map((m, idx) => ({
      month: m,
      status: idx > CURRENT_MONTH_INDEX ? 'upcoming' : 'defaulter',
      feeDue: 50,
      amountPaid: 0,
      remainingDue: 50
    })),
    lastSabaq: {
      date: new Date().toISOString().split('T')[0],
      type: 'Trial Evaluated',
      surah: 'Surah Al-Fatiha',
      status: 'MashaAllah Good',
      rating: 5,
      tags: ['Trial Cleared', 'Enrollment Approved'],
      teacherNote: 'Trial successfully evaluated and enrolled as full student.'
    }
  };

  AppState.students.push(newStudent);
  trial.status = 'Enrolled ✓';
  saveToStorage('lms_students', AppState.students);
  saveToStorage('lms_trial_pipeline', TRIAL_PIPELINE);
  dbSaveStudent(newStudent);
  dbSaveTrial(trial);
  showToastNotification(`✓ Trial ${trial.studentName} enrolled as regular student ${newId}!`);
  renderApp();
}

function openPublishNoticeModal(editNoticeId = null) {
  const modal = document.getElementById('publish-notice-modal');
  if (!modal) return;

  const idInput = document.getElementById('notice-edit-id');
  const titleInput = document.getElementById('notice-title-input');
  const audienceSelect = document.getElementById('notice-audience-select');
  const authorInput = document.getElementById('notice-author-input');
  const contentInput = document.getElementById('notice-content-input');
  const modalTitle = document.getElementById('publish-notice-modal-title');
  const submitBtn = document.getElementById('publish-notice-submit-btn');

  if (editNoticeId) {
    const notice = ACADEMY_NOTICES.find(n => n.id === editNoticeId);
    if (notice) {
      if (idInput) idInput.value = notice.id;
      if (modalTitle) modalTitle.textContent = 'Edit Academy Notice';
      if (submitBtn) submitBtn.innerHTML = '<span>✓</span><span>Save Changes</span>';
      if (titleInput) titleInput.value = notice.title || '';
      if (audienceSelect) audienceSelect.value = notice.audience || 'All Students & Parents';
      if (authorInput) authorInput.value = notice.author || 'Admin Farhan';
      if (contentInput) contentInput.value = notice.content || '';
    }
  } else {
    if (idInput) idInput.value = '';
    if (modalTitle) modalTitle.textContent = 'Post Academy Notice';
    if (submitBtn) submitBtn.innerHTML = '<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg><span>Publish Notice</span>';
    if (titleInput) titleInput.value = '';
    if (audienceSelect) audienceSelect.value = 'All Students & Parents';
    if (authorInput) authorInput.value = 'Admin Farhan';
    if (contentInput) contentInput.value = '';
    clearAllFormErrors(modal);
    initFormDraftAutoSave('new_notice', ['notice-title-input', 'notice-audience-select', 'notice-content-input']);
    restoreFormDraft('new_notice', {
      'notice-title-input': (val) => { if (titleInput) titleInput.value = val; },
      'notice-audience-select': (val) => { if (audienceSelect) audienceSelect.value = val; },
      'notice-content-input': (val) => { if (contentInput) contentInput.value = val; }
    });
  }

  modal.classList.add('active');
  if (titleInput) titleInput.focus();
}

function closePublishNoticeModal() {
  const modal = document.getElementById('publish-notice-modal');
  if (modal) modal.classList.remove('active');
}

function handleSaveNotice() {
  const idInput = document.getElementById('notice-edit-id');
  const titleInput = document.getElementById('notice-title-input');
  const audienceSelect = document.getElementById('notice-audience-select');
  const authorInput = document.getElementById('notice-author-input');
  const contentInput = document.getElementById('notice-content-input');

  const editId = idInput ? idInput.value.trim() : '';
  const title = titleInput ? titleInput.value.trim() : '';
  const audience = audienceSelect ? audienceSelect.value : 'All Students & Parents';
  const author = (authorInput && authorInput.value.trim()) ? authorInput.value.trim() : 'Admin Farhan';
  const content = contentInput ? contentInput.value.trim() : '';

  const modalContainer = document.getElementById('publish-notice-modal') || document.body;
  clearAllFormErrors(modalContainer);

  const isValid = validateSharedForm([
    { id: 'notice-title-input', required: true, label: 'Notice title' },
    { id: 'notice-content-input', required: true, label: 'Announcement message body' }
  ]);
  if (!isValid) return;

  try {
    if (editId) {
      const index = ACADEMY_NOTICES.findIndex(n => n.id === editId);
      if (index !== -1) {
        ACADEMY_NOTICES[index].title = title;
        ACADEMY_NOTICES[index].audience = audience;
        ACADEMY_NOTICES[index].author = author;
        ACADEMY_NOTICES[index].content = content;
        addSystemNotification({
          title: 'Notice Updated',
          desc: `Updated academy notice "${title}".`,
          type: 'notice'
        });
        showToastNotification(`✓ Notice "${title}" updated successfully!`);
      }
    } else {
      const newNotice = {
        id: 'NOT-' + (100 + ACADEMY_NOTICES.length + 1),
        title: title,
        audience: audience,
        date: new Date().toISOString().split('T')[0],
        author: author,
        content: content
      };
      ACADEMY_NOTICES.unshift(newNotice);
      clearFormDraft('new_notice');
      dbSaveNotice(newNotice);
      addSystemNotification({
        title: 'Academy Notice Published',
        desc: `Published notice "${title}" for ${audience}.`,
        type: 'notice'
      });
      showToastNotification(`✓ New Notice "${title}" published across Academy!`);
    }

    saveToStorage('lms_notices', ACADEMY_NOTICES);
    closePublishNoticeModal();
    renderApp();
  } catch (err) {
    console.error('Error saving notice:', err);
    showActionErrorModal({
      title: 'Publish Notice Failed',
      message: err.message || 'Could not publish announcement notice.',
      onRetry: () => handleSaveNotice()
    });
  }
}

function deleteNotice(noticeId, event) {
  if (event) {
    event.stopPropagation();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
  const notice = (ACADEMY_NOTICES || []).find(n => 
    n.id === noticeId || 
    String(n.id).trim().toLowerCase() === String(noticeId).trim().toLowerCase() ||
    ((noticeId === 'NOT-001' || noticeId === 'NOT-101') && (n.id === 'NOT-001' || n.id === 'NOT-101' || (n.title && n.title.includes('TEST Notice'))))
  );
  if (!notice) return;

  const msg = `Are you sure you want to delete notice "${notice.title}"?`;
  openDeleteConfirmationModal({
    title: 'Delete Academy Notice',
    message: msg,
    onConfirm: async () => {
      AppState.activeNoticeActionMenuId = null;
      const success = await dbDeleteNotice(notice.id);
      if (success) {
        addSystemNotification({
          title: 'Notice Deleted',
          desc: `Permanently removed academy notice "${notice.title}".`,
          type: 'notice'
        });
        showToastNotification(`✓ Notice "${notice.title}" deleted.`);
      }
    }
  });
}
window.deleteNotice = deleteNotice;

function openAddTrialModal() {
  const modal = document.getElementById('add-trial-modal');
  if (!modal) return;
  const nameInput = document.getElementById('add-trial-name');
  if (nameInput) nameInput.value = '';
  const countryInput = document.getElementById('add-trial-country');
  if (countryInput) countryInput.value = 'UK (London)';
  const dateInput = document.getElementById('add-trial-datetime');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = `${today} 04:30 PM (PKT)`;
  }
  const teacherSelect = document.getElementById('add-trial-teacher');
  if (teacherSelect) {
    teacherSelect.innerHTML = `<option value="Unassigned">Assign Faculty Later...</option>` +
      (AppState.teachers || []).map(t => `<option value="${t.name}">${t.name}</option>`).join('');
  }
  clearAllFormErrors(modal);
  initFormDraftAutoSave('add-trial-modal', 'new_trial', ['add-trial-name', 'add-trial-course', 'add-trial-country']);
  restoreFormDraft('add-trial-modal', 'new_trial', ['add-trial-name', 'add-trial-course', 'add-trial-country']);
  modal.classList.add('active');
}
window.openAddTrialModal = openAddTrialModal;

function closeAddTrialModal() {
  const modal = document.getElementById('add-trial-modal');
  if (modal) modal.classList.remove('active');
}
window.closeAddTrialModal = closeAddTrialModal;

function handleSaveNewTrial() {
  const modalContainer = document.getElementById('add-trial-modal') || document.body;
  clearAllFormErrors(modalContainer);

  const isValid = validateSharedForm([
    { id: 'add-trial-name', required: true, label: 'Candidate student name' }
  ]);
  if (!isValid) return;

  const name = document.getElementById('add-trial-name')?.value?.trim();
  const course = document.getElementById('add-trial-course')?.value || 'Qaida for Beginners';
  const teacherName = document.getElementById('add-trial-teacher')?.value || 'Unassigned';
  const dateTime = document.getElementById('add-trial-datetime')?.value?.trim() || `${new Date().toISOString().split('T')[0]} 04:30 PM (PKT)`;
  const country = document.getElementById('add-trial-country')?.value?.trim() || 'Global';

  const trialId = 'TRL-' + Math.floor(100 + Math.random() * 900);
  const newTrial = {
    id: trialId,
    studentName: name,
    course: course,
    assignedTeacher: teacherName,
    country: country,
    preferredTime: dateTime,
    status: 'Trial Booked',
    date: new Date().toISOString().split('T')[0],
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0E4D45&color=fff`
  };

  try {
    TRIAL_PIPELINE.unshift(newTrial);
    saveToStorage('lms_trial_pipeline', TRIAL_PIPELINE);
    dbSaveTrial(newTrial);
    clearFormDraft('new_trial');
    addSystemNotification({
      title: 'Trial Assessment Scheduled',
      desc: `New trial booked for ${name} (${course}) with faculty ${teacherName}.`,
      type: 'trial'
    });
    closeAddTrialModal();
    renderApp();
    showToastNotification(`✓ Trial scheduled for "${name}" successfully!`);
  } catch (err) {
    console.error('Error saving trial:', err);
    showActionErrorModal({
      title: 'Save Trial Failed',
      message: err.message || 'Could not record candidate trial.',
      onRetry: () => handleSaveNewTrial()
    });
  }
}
window.handleSaveNewTrial = handleSaveNewTrial;

function toggleNoticeActionMenu(noticeId, event) {
  if (event) event.stopPropagation();
  AppState.activeNoticeActionMenuId = (AppState.activeNoticeActionMenuId === noticeId) ? null : noticeId;
  renderApp();
}

function closeNoticeActionMenu() {
  if (AppState.activeNoticeActionMenuId) {
    AppState.activeNoticeActionMenuId = null;
    renderApp();
  }
}

function handleAssignTeacherToTrial(trialId, teacherName) {
  const trial = TRIAL_PIPELINE.find(t => t.id === trialId);
  if (!trial) return;
  trial.assignedTeacher = teacherName || 'Unassigned';
  showToastNotification(`✓ Assigned ${teacherName} to trial candidate ${trial.studentName}`);
  renderApp();
}

// ==========================================
// 2. FIFO WATERFALL PAYMENT ENGINE
// ==========================================

/**
 * Calculates FIFO Waterfall payment allocation for a student or family group
 * Chronologically settles oldest unpaid/partial dues first,
 * then allocates any surplus to upcoming future months as advance.
 */
function calculateFIFOWaterfall(studentOrTarget, paymentAmount, targetMonthIndex = null) {
  paymentAmount = Number(paymentAmount) || 0;
  if (paymentAmount <= 0) return { allocations: [], remainingSurplus: 0, newTotalDue: 0, studentSimulations: [] };

  if (targetMonthIndex === null || targetMonthIndex === undefined || isNaN(targetMonthIndex)) {
    const monthSelect = document.getElementById('modal-fee-month-select');
    targetMonthIndex = monthSelect ? parseInt(monthSelect.value, 10) : CURRENT_MONTH_INDEX;
  }
  if (isNaN(targetMonthIndex) || targetMonthIndex < 0 || targetMonthIndex > 11) {
    targetMonthIndex = CURRENT_MONTH_INDEX;
  }

  let isFamily = false;
  let familyId = null;
  let studentsInvolved = [];

  if (typeof studentOrTarget === 'string') {
    if (isFamilyTarget(studentOrTarget)) {
      isFamily = true;
      familyId = studentOrTarget;
      studentsInvolved = (AppState.students || []).filter(s => s.familyId === familyId || s.familyTag === familyId);
    } else {
      const s = (AppState.students || []).find(st => st.id === studentOrTarget);
      if (s) studentsInvolved = [s];
    }
  } else if (studentOrTarget && (studentOrTarget.isFamily || studentOrTarget.familyId)) {
    isFamily = true;
    familyId = studentOrTarget.familyId;
    studentsInvolved = (AppState.students || []).filter(s => s.familyId === familyId || s.familyTag === familyId);
  } else if (studentOrTarget) {
    studentsInvolved = [studentOrTarget];
  }

  if (studentsInvolved.length === 0) return { allocations: [], remainingSurplus: 0, newTotalDue: 0, studentSimulations: [] };

  let remainingMoney = paymentAmount;
  const allocations = [];

  // Clone months for each student
  const studentSimulations = studentsInvolved.map(s => ({
    studentId: s.id,
    studentName: `${s.firstName} ${s.lastName}`,
    currency: s.currency,
    currencyCode: s.currencyCode,
    monthlyFee: s.monthlyFee,
    months: JSON.parse(JSON.stringify(s.months))
  }));

  function allocateToMonth(sim, monthIdx, isAdv) {
    if (remainingMoney <= 0) return;
    const m = sim.months[monthIdx];
    if (!m) return;
    const effectiveFeeDue = m.feeDue > 0 ? m.feeDue : (Number(sim.monthlyFee) || 50);
    const dueInMonth = effectiveFeeDue - (m.amountPaid || 0);
    if (dueInMonth > 0) {
      const allocate = Math.min(remainingMoney, dueInMonth);
      const newPaid = (m.amountPaid || 0) + allocate;
      const newRemaining = Math.max(0, effectiveFeeDue - newPaid);
      const prevStatus = m.status;
      const newStatus = newRemaining === 0 ? (isAdv ? 'advance' : 'paid') : 'partial';

      allocations.push({
        studentId: sim.studentId,
        studentName: sim.studentName,
        currency: sim.currency,
        currencyCode: sim.currencyCode,
        monthIndex: monthIdx,
        month: m.month,
        feeDue: effectiveFeeDue,
        previouslyPaid: m.amountPaid || 0,
        allocatedAmount: allocate,
        newAmountPaid: newPaid,
        newRemainingDue: newRemaining,
        prevStatus: prevStatus,
        newStatus: newStatus,
        isAdvance: isAdv
      });

      m.feeDue = effectiveFeeDue;
      m.amountPaid = newPaid;
      m.remainingDue = newRemaining;
      m.status = newStatus;
      remainingMoney -= allocate;
    }
  }

  // Pass 1: Prioritize the selected Target Academic Month!
  if (targetMonthIndex !== null && targetMonthIndex >= 0 && targetMonthIndex < 12) {
    for (const sim of studentSimulations) {
      if (remainingMoney <= 0) break;
      allocateToMonth(sim, targetMonthIndex, targetMonthIndex > CURRENT_MONTH_INDEX);
    }
  }

  // Pass 2: Settle past/current enrolled months chronologically (from oldest to current, skipping targetMonthIndex)
  for (let i = 0; i <= CURRENT_MONTH_INDEX && remainingMoney > 0; i++) {
    if (i === targetMonthIndex) continue;
    for (const sim of studentSimulations) {
      if (remainingMoney <= 0) break;
      if (sim.months[i]?.status === 'not_enrolled') continue;
      allocateToMonth(sim, i, false);
    }
  }

  // Pass 3: If surplus remains, roll forward into future months as ADVANCE (skipping targetMonthIndex)
  for (let i = CURRENT_MONTH_INDEX + 1; i < 12 && remainingMoney > 0; i++) {
    if (i === targetMonthIndex) continue;
    for (const sim of studentSimulations) {
      if (remainingMoney <= 0) break;
      allocateToMonth(sim, i, true);
    }
  }

  // Calculate new total balance due across involved students
  let newTotalDue = 0;
  for (const sim of studentSimulations) {
    for (let i = 0; i <= CURRENT_MONTH_INDEX; i++) {
      if (sim.months[i]?.status !== 'not_enrolled') {
        newTotalDue += (sim.months[i].remainingDue || 0);
      }
    }
  }

  return {
    allocations,
    remainingSurplus: remainingMoney,
    newTotalDue,
    isFamily,
    familyId,
    studentSimulations,
    simulatedMonths: studentSimulations[0]?.months || []
  };
}

/**
 * Execute and commit the FIFO payment to state and transaction ledger
 */
function commitFIFOPayment(targetId, amount, paymentMethod = 'Online Portal', targetMonthIndex = null) {
  if (targetMonthIndex === null || targetMonthIndex === undefined || isNaN(targetMonthIndex)) {
    const monthSelect = document.getElementById('modal-fee-month-select');
    targetMonthIndex = monthSelect ? parseInt(monthSelect.value, 10) : CURRENT_MONTH_INDEX;
  }
  const result = calculateFIFOWaterfall(targetId, amount, targetMonthIndex);
  if (result.allocations.length === 0) return false;

  // Apply simulated months to actual students
  result.studentSimulations.forEach(sim => {
    const student = AppState.students.find(s => s.id === sim.studentId);
    if (student) {
      student.months = sim.months;
      dbSaveStudent(student);
    }
  });

  const currency = result.studentSimulations[0].currency;
  const currencyCode = result.studentSimulations[0].currencyCode || null;
  // Freeze this payment's PKR equivalent at the current rate. It is
  // never recalculated, so later rate changes cannot rewrite history.
  const pkrRate = currencyCode ? getCurrencyRate(currencyCode) : null;
  const pkrAmount = pkrRate !== null ? Math.round(amount * pkrRate) : null;
  const isFamily = result.isFamily;
  const guardianName = isFamily 
    ? (AppState.students.find(s => s.familyId === result.familyId || s.familyTag === result.familyId)?.guardianName || 'Guardian')
    : '';
  const studentName = isFamily 
    ? `Family Combined (${result.familyId}: ${guardianName})` 
    : result.studentSimulations[0].studentName;
  const studentId = isFamily ? result.familyId : result.studentSimulations[0].studentId;

  // Summary of allocation text
  const allocationSummary = result.allocations
    .map(a => `${isFamily ? a.studentName.split(' ')[0] + ' ' : ''}${a.month} (${currency}${a.allocatedAmount} ➔ ${a.newStatus.toUpperCase()})`)
    .join(', ');

  // Add to Payment Ledger
  const txnId = 'TXN-' + Math.floor(1000 + Math.random() * 9000);
  const paymentTxn = {
    id: txnId,
    date: new Date().toISOString().split('T')[0],
    studentId: studentId,
    studentName: studentName,
    amount: amount,
    currency: currency,
    currencyCode: currencyCode,
    ...(pkrAmount !== null ? { pkrAmount: pkrAmount, pkrRate: pkrRate, pkrMonth: currentMonthKey() } : {}),
    type: isFamily ? 'Family Combined Invoice' : (result.allocations.some(a => a.isAdvance) ? 'Advance / Combined Fee' : 'Tuition Settlement'),
    allocatedTo: allocationSummary,
    allocations: result.allocations,
    method: paymentMethod,
    status: 'Completed'
  };
  PAYMENT_LEDGER.unshift(paymentTxn);
  dbSavePaymentTransaction(paymentTxn);

  saveToStorage('lms_students', AppState.students);
  saveToStorage('lms_payment_ledger', PAYMENT_LEDGER);

  addSystemNotification({
    title: 'Tuition Fee Received',
    desc: `Recorded fee payment of ${currency}${amount} for ${studentName}. Receipt #${txnId}. Allocation: ${allocationSummary}`,
    type: 'fee',
    amount: `${currency}${amount}`,
    receiptNo: txnId,
    date: paymentTxn.date
  });

  return {
    txnId,
    studentName,
    currency,
    pkrAmount,
    allocationSummary,
    result
  };
}

// ==========================================
// 3. PII MASKING & ROLE LOGIC (MODULE 1)
// ==========================================

/**
 * Returns formatted student display object with strict PII masking
 * Admin: Full visibility of phone, email, WhatsApp, address, exact fee
 * Manager & Teacher: ID + First Name + Country/Timezone; Contact fields hidden
 */
function getStudentDisplay(student, role = AppState.currentRole) {
  const isPrivilegedAdmin = (role === 'admin');

  return {
    ...student,
    displayName: isPrivilegedAdmin 
      ? `${student.firstName} ${student.lastName}` 
      : `${student.id} • ${student.firstName} (${student.country})`,
    maskedFullName: `${student.firstName} ${student.lastName.charAt(0)}.`,
    guardianDisplay: isPrivilegedAdmin 
      ? student.guardianName 
      : '<span class="inline-flex items-center gap-1 text-[11px] text-[#7A8684]"><svg class="w-3 h-3 text-[#A3C2BE]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg> Hidden by Admin</span>',
    phoneDisplay: isPrivilegedAdmin 
      ? student.phone 
      : '<span class="inline-flex items-center gap-1 text-[11px] text-[#7A8684]"><svg class="w-3 h-3 text-[#A3C2BE]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg> Hidden by Admin</span>',
    whatsappDisplay: isPrivilegedAdmin 
      ? student.whatsapp 
      : '<span class="inline-flex items-center gap-1 text-[11px] text-[#7A8684]"><svg class="w-3 h-3 text-[#A3C2BE]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg> Hidden by Admin</span>',
    emailDisplay: isPrivilegedAdmin 
      ? student.email 
      : '<span class="inline-flex items-center gap-1 text-[11px] text-[#7A8684]"><svg class="w-3 h-3 text-[#A3C2BE]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg> Hidden by Admin</span>',
    addressDisplay: isPrivilegedAdmin 
      ? student.address 
      : '<span class="inline-flex items-center gap-1 text-[11px] text-[#7A8684]"><svg class="w-3 h-3 text-[#A3C2BE]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg> Hidden by Admin</span>',
    isMasked: !isPrivilegedAdmin
  };
}

/**
 * Computes overall student fee status
 */
function getStudentFeeStatus(student) {
  if (!student || !Array.isArray(student.months) || student.months.length === 0) {
    return { code: 'paid', label: 'Paid (Clear)', badgeClass: 'ts-badge-paid' };
  }
  // Check past/current months for defaulter or partial
  let hasDefaulter = false;
  let hasPartial = false;
  let hasAdvance = false;

  const maxMonth = Math.min(CURRENT_MONTH_INDEX, student.months.length - 1);
  for (let i = 0; i <= maxMonth; i++) {
    const m = student.months[i];
    if (m) {
      if (m.status === 'defaulter') hasDefaulter = true;
      if (m.status === 'partial') hasPartial = true;
    }
  }

  for (let i = CURRENT_MONTH_INDEX + 1; i < student.months.length; i++) {
    if (student.months[i] && student.months[i].status === 'advance') hasAdvance = true;
  }

  if (hasDefaulter) return { code: 'defaulter', label: 'Overdue', badgeClass: 'ts-badge-defaulter' };
  if (hasPartial) return { code: 'partial', label: 'Partial', badgeClass: 'ts-badge-partial' };
  if (hasAdvance) return { code: 'advance', label: 'Advance', badgeClass: 'ts-badge-advance' };
  return { code: 'paid', label: 'Paid', badgeClass: 'ts-badge-paid' };
}

/**
 * Minimalist Stripe-style status label with soft indicator dot
 */
function renderStudentLedgerStatusPill(student) {
  const status = getStudentFeeStatus(student);
  if (status.code === 'defaulter') {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]/60"><span class="w-1.5 h-1.5 rounded-full bg-[#EF4444]"></span>Overdue</span>`;
  } else if (status.code === 'partial') {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]/60"><span class="w-1.5 h-1.5 rounded-full bg-[#D97706]"></span>Partial</span>`;
  } else if (status.code === 'advance') {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#E0F2FE] text-[#0369A1] border border-[#BAE6FD]/60"><span class="w-1.5 h-1.5 rounded-full bg-[#0284C7]"></span>Advance</span>`;
  } else {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#E0F2F1] text-[#0E4D45] border border-[#A7F3D0]/60"><span class="w-1.5 h-1.5 rounded-full bg-[#0E4D45]"></span>Paid</span>`;
  }
}

/**
 * Total balance due up to current month
 */
function getStudentBalanceDue(student) {
  let totalDue = 0;
  if (!student || !Array.isArray(student.months)) return 0;
  const maxMonth = Math.min(CURRENT_MONTH_INDEX, student.months.length - 1);
  for (let i = 0; i <= maxMonth; i++) {
    if (student.months[i] && student.months[i].status !== 'not_enrolled') {
      totalDue += (student.months[i].remainingDue || 0);
    }
  }
  return totalDue;
}

// ==========================================
// ==========================================
// 4. PROFILE & PORTAL SWITCHER ENGINE
// ==========================================

const PORTAL_ROLES = {
  admin: {
    id: 'admin',
    name: 'Admin Farhan Al-Husseini',
    shortName: 'Admin Farhan',
    title: 'Super Administrator',
    badge: 'Super Admin',
    initials: 'AF',
    desc: 'Complete Student & Financial Records',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />`
  },
  manager: {
    id: 'manager',
    name: 'Manager Tariq Jameel',
    shortName: 'Manager Tariq',
    title: 'Academic Operations Manager',
    badge: 'Ops Manager',
    initials: 'TJ',
    desc: 'Protected Student Privacy & Live Sessions',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />`
  },
  teacher: {
    id: 'teacher',
    name: 'Ustadh Bilal Tariq',
    shortName: 'Ustadh Bilal',
    title: 'Senior Qari & Teacher',
    badge: 'Faculty',
    initials: 'BT',
    desc: '30-Sec Sabaq Logger & Student Schedule',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />`
  },
  student: {
    id: 'student',
    name: 'Parent: Dr. Tariq Khan',
    shortName: 'Dr. Tariq Khan',
    title: 'Guardian (Zaid & Sara Khan)',
    badge: 'Family View',
    initials: 'TK',
    desc: 'Tuition Balance, Sabaq Progress & Receipts',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />`
  }
};

// System Notifications Data & Controller
let SYSTEM_NOTIFICATIONS = loadFromStorage('lms_notifications', []);
try {
  Object.defineProperty(window, 'SYSTEM_NOTIFICATIONS', {
    get() { return SYSTEM_NOTIFICATIONS; },
    set(v) { SYSTEM_NOTIFICATIONS = v; },
    configurable: true
  });
} catch (e) {
  window.SYSTEM_NOTIFICATIONS = SYSTEM_NOTIFICATIONS;
}

function seedInitialActivityNotifications() {
  if (!Array.isArray(SYSTEM_NOTIFICATIONS)) {
    SYSTEM_NOTIFICATIONS = [];
  }
}

function addSystemNotification(item) {
  if (!Array.isArray(SYSTEM_NOTIFICATIONS)) SYSTEM_NOTIFICATIONS = [];
  const notif = {
    id: 'NOTIF-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    title: item.title,
    desc: item.desc,
    type: item.type || 'info',
    amount: item.amount || null,
    receiptNo: item.receiptNo || null,
    date: item.date || 'Nov 24, 2026',
    time: item.time || item.date || new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    unread: true,
    timestamp: Date.now()
  };
  SYSTEM_NOTIFICATIONS.unshift(notif);
  if (SYSTEM_NOTIFICATIONS.length > 80) SYSTEM_NOTIFICATIONS.length = 80;
  saveToStorage('lms_notifications', SYSTEM_NOTIFICATIONS);
  renderNotificationsDropdownContent();
  if (document.getElementById('full-activity-log-modal')?.classList.contains('active')) {
    renderFullActivityLogContent();
  }
}
window.addSystemNotification = addSystemNotification;

// Full Activity Log Controller & State
let currentActivityFilter = 'all';
let currentActivitySearch = '';

function setActivityLogFilter(filter) {
  currentActivityFilter = filter;
  const buttons = document.querySelectorAll('.activity-filter-btn');
  buttons.forEach(btn => {
    if (btn.getAttribute('data-filter') === filter) {
      btn.className = 'activity-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0E4D45] text-white shadow-2xs transition-colors cursor-pointer';
    } else {
      btn.className = 'activity-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#F8F6F1] text-[#7A8684] hover:text-[#141F1E] transition-colors cursor-pointer';
    }
  });
  renderFullActivityLogContent();
}
window.setActivityLogFilter = setActivityLogFilter;

function handleActivityLogSearch(val) {
  currentActivitySearch = (val || '').trim().toLowerCase();
  renderFullActivityLogContent();
}
window.handleActivityLogSearch = handleActivityLogSearch;

function openFullActivityLogModal() {
  closeNotificationsDropdown();
  const modal = document.getElementById('full-activity-log-modal');
  if (!modal) {
    openNotificationsModal();
    return;
  }
  currentActivityFilter = 'all';
  currentActivitySearch = '';
  const searchInput = document.getElementById('activity-log-search-input');
  if (searchInput) searchInput.value = '';
  setActivityLogFilter('all');
  modal.classList.add('active');
}
window.openFullActivityLogModal = openFullActivityLogModal;

function closeFullActivityLogModal() {
  const modal = document.getElementById('full-activity-log-modal');
  if (modal) modal.classList.remove('active');
}
window.closeFullActivityLogModal = closeFullActivityLogModal;

function renderFullActivityLogContent() {
  const container = document.getElementById('full-activity-log-body');
  if (!container) return;

  const notifs = Array.isArray(SYSTEM_NOTIFICATIONS) ? SYSTEM_NOTIFICATIONS : [];

  // Count by categories
  const countAll = notifs.length;
  const countFee = notifs.filter(n => n.type === 'fee' || (n.title && /fee|tuition|payment|settlement/i.test(n.title))).length;
  const countStudent = notifs.filter(n => n.type === 'student' || (n.title && /student|enrolled/i.test(n.title))).length;
  const countTeacher = notifs.filter(n => n.type === 'teacher' || (n.title && /faculty|teacher|payroll/i.test(n.title))).length;
  const countNotice = notifs.filter(n => n.type === 'notice' || (n.title && /notice/i.test(n.title))).length;

  const elAll = document.getElementById('activity-count-all');
  const elFee = document.getElementById('activity-count-fee');
  const elStudent = document.getElementById('activity-count-student');
  const elTeacher = document.getElementById('activity-count-teacher');
  const elNotice = document.getElementById('activity-count-notice');
  if (elAll) elAll.textContent = countAll;
  if (elFee) elFee.textContent = countFee;
  if (elStudent) elStudent.textContent = countStudent;
  if (elTeacher) elTeacher.textContent = countTeacher;
  if (elNotice) elNotice.textContent = countNotice;

  let filtered = notifs.filter(n => {
    if (currentActivityFilter === 'fee') {
      if (n.type !== 'fee' && !(n.title && /fee|tuition|payment|settlement/i.test(n.title))) return false;
    } else if (currentActivityFilter === 'student') {
      if (n.type !== 'student' && !(n.title && /student|enrolled/i.test(n.title))) return false;
    } else if (currentActivityFilter === 'teacher') {
      if (n.type !== 'teacher' && !(n.title && /faculty|teacher|payroll/i.test(n.title))) return false;
    } else if (currentActivityFilter === 'notice') {
      if (n.type !== 'notice' && !(n.title && /notice/i.test(n.title))) return false;
    }

    if (currentActivitySearch) {
      const q = currentActivitySearch;
      const t = (n.title || '').toLowerCase();
      const d = (n.desc || '').toLowerCase();
      const r = (n.receiptNo || '').toLowerCase();
      const a = (n.amount || '').toLowerCase();
      const dt = (n.time || n.date || '').toLowerCase();
      return t.includes(q) || d.includes(q) || r.includes(q) || a.includes(q) || dt.includes(q);
    }
    return true;
  });

  const footerSummary = document.getElementById('activity-log-footer-summary');
  if (footerSummary) {
    footerSummary.textContent = `Showing ${filtered.length} of ${countAll} activity entries`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="py-14 text-center flex flex-col items-center justify-center text-[#7A8684]">
        <div class="w-12 h-12 rounded-2xl bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mb-3">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <p class="text-sm font-bold text-[#141F1E]">No Activity Records Found</p>
        <p class="text-xs text-[#7A8684] mt-1">No log entries matched your filter or search criteria.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="space-y-3">
      ${filtered.map(item => {
        let typeBadgeBg = 'bg-[#E0F2F1] text-[#0E4D45]';
        let typeLabel = 'System Log';
        if (item.type === 'fee') {
          typeBadgeBg = 'bg-[#D1FAE5] text-[#065F46] border border-[#A7F3D0]';
          typeLabel = 'Fee Settlement';
        } else if (item.type === 'student') {
          typeBadgeBg = 'bg-[#E0F2F1] text-[#0E4D45] border border-[#A3C2BE]';
          typeLabel = item.title?.includes('Removed') ? 'Student Deleted' : 'Student Enrollment';
        } else if (item.type === 'teacher') {
          typeBadgeBg = 'bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]';
          typeLabel = item.title?.includes('Removed') ? 'Faculty Removed' : 'Faculty Member';
        } else if (item.type === 'notice') {
          typeBadgeBg = 'bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]';
          typeLabel = item.title?.includes('Deleted') ? 'Notice Deleted' : 'Academy Notice';
        } else if (item.type === 'delete') {
          typeBadgeBg = 'bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA]';
          typeLabel = 'Record Deleted';
        }

        return `
          <div class="p-4 rounded-2xl bg-white border border-[#ECEAE4] hover:border-[#CBD5E1] transition-all shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div class="flex items-start gap-3.5 min-w-0 flex-1">
              ${getNotificationIconHtml(item.type)}
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap mb-1">
                  <span class="font-bold text-[#141F1E] text-xs leading-snug">${item.title}</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${typeBadgeBg}">${typeLabel}</span>
                  <span class="text-[11px] text-[#7A8684] font-medium">• ${item.time || item.date || 'Nov 24, 2026'}</span>
                </div>
                <p class="text-xs text-[#334E4B] leading-relaxed">${item.desc}</p>
              </div>
            </div>
            ${(item.amount || item.receiptNo) ? `
              <div class="flex items-center gap-2 shrink-0 self-end sm:self-center pl-11 sm:pl-0">
                ${item.amount ? `
                  <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-extrabold bg-[#E8EFEE] text-[#0E4D45] border border-[#A3C2BE]/30">
                    ${item.amount}
                  </span>
                ` : ''}
                ${item.receiptNo ? `
                  <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-[#F8F6F1] text-[#141F1E] border border-[#ECEAE4]">
                    #${item.receiptNo}
                  </span>
                ` : ''}
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}
window.renderFullActivityLogContent = renderFullActivityLogContent;

function toggleNotificationsDropdown(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('notifications-dropdown-menu');
  if (!menu) return;
  const isHidden = menu.classList.contains('hidden');
  if (isHidden) {
    // Close other header dropdowns
    closeProfileDropdown();
    const monthDropdown = document.getElementById('month-year-dropdown');
    if (monthDropdown) monthDropdown.classList.add('hidden');
    renderNotificationsDropdownContent();
    menu.classList.remove('hidden');
  } else {
    menu.classList.add('hidden');
  }
}

function closeNotificationsDropdown() {
  const menu = document.getElementById('notifications-dropdown-menu');
  if (menu) menu.classList.add('hidden');
}

function markAllNotificationsAsRead(event) {
  if (event) event.stopPropagation();
  SYSTEM_NOTIFICATIONS.forEach(n => n.unread = false);
  const dot = document.getElementById('notification-badge-dot');
  if (dot) dot.classList.add('hidden');
  const countPill = document.getElementById('notification-unread-count');
  if (countPill) {
    countPill.textContent = '0 New';
    countPill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F8F6F1] text-[#7A8684]';
  }
  renderNotificationsDropdownContent();
  showToastNotification('✓ All notifications marked as read');
}

function renderNotificationsDropdownContent() {
  const container = document.getElementById('notifications-dropdown-list');
  if (!container) return;

  const unreadCount = SYSTEM_NOTIFICATIONS.filter(n => n.unread).length;
  const dot = document.getElementById('notification-badge-dot');
  if (dot) {
    if (unreadCount === 0) dot.classList.add('hidden');
    else dot.classList.remove('hidden');
  }
  const countPill = document.getElementById('notification-unread-count');
  if (countPill) {
    countPill.textContent = unreadCount > 0 ? `${unreadCount} New` : '0 New';
    countPill.className = unreadCount > 0 
      ? 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E8EFEE] text-[#0E4D45]' 
      : 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F8F6F1] text-[#7A8684]';
  }

  if (SYSTEM_NOTIFICATIONS.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center text-[#7A8684]">
        <div class="w-9 h-9 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mx-auto mb-2 text-xs">
          <svg class="w-4 h-4 text-[#0E4D45]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
        </div>
        <p class="text-xs font-semibold text-[#141F1E]">No new notifications</p>
        <p class="text-[11px] text-[#7A8684] mt-0.5">Live operational logs & alerts will appear here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = SYSTEM_NOTIFICATIONS.map(n => `
    <div class="p-3 rounded-xl ${n.unread ? 'bg-[#F8F6F1] border border-[#ECEAE4]' : 'bg-white border border-transparent hover:bg-[#F8F6F1]'} transition-colors flex items-start gap-2.5">
      <div class="w-7 h-7 rounded-lg ${n.type === 'success' ? 'bg-[#E0F2F1] text-[#0E4D45]' : 'bg-blue-50 text-blue-700'} flex items-center justify-center flex-shrink-0 text-xs">
        ${n.type === 'success' ? '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' : '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>'}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-1">
          <span class="font-bold text-[#141F1E] text-xs truncate">${n.title}</span>
          <span class="text-[10px] text-[#7A8684] shrink-0">${n.time}</span>
        </div>
        <p class="text-[11px] text-[#7A8684] mt-0.5 leading-snug">${n.desc}</p>
      </div>
    </div>
  `).join('');
}

function toggleProfileDropdown(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('profile-dropdown-menu');
  if (!menu) return;
  const isHidden = menu.classList.contains('hidden');
  if (isHidden) {
    closeNotificationsDropdown();
    const monthDropdown = document.getElementById('month-year-dropdown');
    if (monthDropdown) monthDropdown.classList.add('hidden');
    renderProfileDropdownContent();
    menu.classList.remove('hidden');
  } else {
    menu.classList.add('hidden');
  }
}

function closeProfileDropdown() {
  const menu = document.getElementById('profile-dropdown-menu');
  if (menu) menu.classList.add('hidden');
}

function selectRoleFromDropdown(roleId) {
  closeProfileDropdown();
  switchRole(roleId);
  const info = PORTAL_ROLES[roleId];
  if (info) {
    showToastNotification(`\u2713 Switched to ${info.badge} (${info.name})`);
  }
}

function renderProfileDropdownContent() {
  const menu = document.getElementById('profile-dropdown-menu');
  if (!menu) return;

  const current = PORTAL_ROLES[AppState.currentRole] || PORTAL_ROLES.admin;
  const rolesList = ['admin', 'manager', 'teacher', 'student'];

  const itemsHtml = rolesList.map(rKey => {
    const r = PORTAL_ROLES[rKey];
    const isActive = AppState.currentRole === rKey;
    const activeBg = isActive 
      ? 'bg-[#E8EFEE] text-[#0E4D45] border border-[#236058]/30 font-semibold' 
      : 'text-[#141F1E] hover:bg-[#F8F6F1] border border-transparent';
    const iconBg = isActive ? 'bg-[#0E4D45] text-white' : 'bg-[#F0EDE6] text-[#7A8684] group-hover:bg-[#E8EFEE] group-hover:text-[#0E4D45]';
    
    return `
      <button type="button" onclick="selectRoleFromDropdown('${r.id}')" 
        class="w-full text-left p-2.5 rounded-xl transition-all flex items-center justify-between gap-2.5 ${activeBg} group cursor-pointer">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${iconBg}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              ${r.icon}
            </svg>
          </div>
          <div class="truncate">
            <div class="text-xs font-bold leading-tight flex items-center gap-1.5">
              <span>${r.name.split(':')[0]}</span>
              <span class="text-[9.5px] px-1.5 py-0.2 rounded-full font-medium ${isActive ? 'bg-[#0E4D45] text-white' : 'bg-[#ECEAE4] text-[#7A8684]'}">${r.badge}</span>
            </div>
            <div class="text-[10px] text-[#7A8684] truncate mt-0.5">${r.desc}</div>
          </div>
        </div>
        ${isActive ? `
          <div class="w-5 h-5 rounded-full bg-[#0E4D45] text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
            \u2713
          </div>
        ` : `
          <div class="w-5 h-5 rounded-full border border-[#D5D1C7] flex items-center justify-center text-[10px] text-transparent group-hover:border-[#0E4D45] flex-shrink-0">
            \u2022
          </div>
        `}
      </button>
    `;
  }).join('');

  menu.innerHTML = `
    <!-- Dropdown Header: Current User -->
    <div class="p-2 pb-2.5 border-b border-[#ECEAE4]">
      <div class="flex items-center gap-2.5">
        <div class="w-9 h-9 rounded-full bg-[#0E4D45] text-white font-bold text-xs flex items-center justify-center flex-shrink-0 shadow-sm">
          ${current.initials}
        </div>
        <div class="min-w-0">
          <div class="text-xs font-bold text-[#141F1E] truncate">${current.name}</div>
          <div class="text-[10.5px] text-[#7A8684] truncate">${current.title}</div>
        </div>
      </div>
      <div class="mt-2 flex items-center justify-between text-[10px] bg-[#F8F6F1] px-2 py-1 rounded-lg">
        <span class="text-[#7A8684]">Active Portal:</span>
        <span class="font-bold text-[#0E4D45]">${current.badge}</span>
      </div>
    </div>

    <!-- Section Title: SWITCH PORTAL VIEW -->
    <div class="mt-2">
      <div class="text-[9.5px] font-bold text-[#7A8684] uppercase tracking-wider px-2 py-1 flex items-center justify-between">
        <span>SWITCH PORTAL VIEW</span>
        <span class="text-[8.5px] font-normal text-[#A3C2BE] bg-[#0E4D45]/10 px-1.5 py-0.5 rounded text-[#0E4D45]">4 Portals</span>
      </div>
      <div class="space-y-1 mt-1">
        ${itemsHtml}
      </div>
    </div>

    <!-- Dropdown Footer -->
    <div class="mt-2.5 pt-2 border-t border-[#ECEAE4] px-2 flex items-center justify-between text-[10px] text-[#7A8684]">
      <span class="flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
        <span>Academic Year</span>
      </span>
      <span class="font-bold text-[#0E4D45]">${CURRENT_YEAR || 2026} Active</span>
    </div>
  `;
}

function switchRole(role) {
  AppState.currentRole = role;
  
  // Set default nav for each role
  if (role === 'admin') AppState.activeNav = 'dashboard';
  if (role === 'manager') AppState.activeNav = 'manager-radar';
  if (role === 'teacher') AppState.activeNav = 'teacher-schedule';
  if (role === 'student') AppState.activeNav = 'student-portal';

  updateRolePillUI();
  renderApp();
}

function updateRolePillUI() {
  const current = PORTAL_ROLES[AppState.currentRole] || PORTAL_ROLES.admin;

  const avatarEl = document.getElementById('top-user-avatar');
  const userNameEl = document.getElementById('top-user-name');
  const userRoleEl = document.getElementById('top-user-role');
  const heroGreetingEl = document.getElementById('hero-user-name');
  
  if (avatarEl) avatarEl.textContent = current.initials;
  if (userNameEl) userNameEl.textContent = current.name;
  if (userRoleEl) userRoleEl.textContent = current.title;
  if (heroGreetingEl) heroGreetingEl.textContent = current.shortName;

  // Sync mobile drawer profile
  const drawerAvatar = document.getElementById('drawer-user-avatar');
  const drawerName = document.getElementById('drawer-user-name');
  const drawerRole = document.getElementById('drawer-user-role');
  if (drawerAvatar) drawerAvatar.textContent = current.initials;
  if (drawerName) drawerName.textContent = current.name;
  if (drawerRole) drawerRole.textContent = current.title;

  // Re-render dropdown content if it is currently open
  const menu = document.getElementById('profile-dropdown-menu');
  if (menu && !menu.classList.contains('hidden')) {
    renderProfileDropdownContent();
  }
}

// Mobile Slide-out Drawer Controller (High-Performance Hardware-Accelerated)
function toggleMobileDrawer(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('mobile-drawer-backdrop');
  if (!drawer || !backdrop) return;
  const isOpen = drawer.classList.contains('drawer-open');
  if (isOpen) {
    closeMobileDrawer(e);
  } else {
    drawer.classList.add('drawer-open');
    backdrop.classList.add('drawer-open');
    document.body.classList.add('drawer-open-lock');
  }
}

function closeMobileDrawer(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('mobile-drawer-backdrop');
  if (!drawer || !backdrop) return;
  drawer.classList.remove('drawer-open');
  backdrop.classList.remove('drawer-open');
  document.body.classList.remove('drawer-open-lock');
}

window.toggleMobileDrawer = toggleMobileDrawer;
window.closeMobileDrawer = closeMobileDrawer;

// Keyboard accessibility: Escape key closes all open dropdowns, popovers, and drawer
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMobileDrawer();
    closeProfileDropdown();
    closeNotificationsDropdown();
    const monthDropdown = document.getElementById('month-year-dropdown');
    if (monthDropdown) monthDropdown.classList.add('hidden');
    if (typeof closeStudentActionMenu === 'function') closeStudentActionMenu();
    if (typeof closeStudentSchedulePopover === 'function') closeStudentSchedulePopover();
    if (typeof closeStudentContactPopover === 'function') closeStudentContactPopover();
    if (typeof closeFeeFilterDropdown === 'function') closeFeeFilterDropdown();
    if (typeof closeNoticeActionMenu === 'function') closeNoticeActionMenu();
    if (typeof closeAddStudentModal === 'function') closeAddStudentModal();
    if (typeof closeAddTeacherModal === 'function') closeAddTeacherModal();
    if (typeof closeAddTrialModal === 'function') closeAddTrialModal();
    if (typeof closeDeleteConfirmationModal === 'function') closeDeleteConfirmationModal();
  }
});

// Auto-close mobile drawer when viewport expands to desktop
window.addEventListener('resize', () => {
  if (window.innerWidth >= 769) {
    closeMobileDrawer();
  }
});

function renderApp() {
  const container = document.getElementById('main-dynamic-content');
  if (!container) return;

  // Render based on active role and nav
  if (AppState.currentRole === 'admin') {
    if (AppState.activeNav === 'dashboard') {
      container.innerHTML = renderAdminDashboardView();
      initAttendanceDotMatrix();
    } else if (AppState.activeNav === 'fee-matrix') {
      container.innerHTML = renderAdminFeeMatrixView();
    } else if (AppState.activeNav === 'students') {
      container.innerHTML = renderAdminStudentsDirectory();
    } else if (AppState.activeNav === 'teachers') {
      container.innerHTML = renderAdminTeacherPayrollView();
    } else if (AppState.activeNav === 'trials-notices') {
      container.innerHTML = renderAdminTrialsAndNoticesView();
    } else if (AppState.activeNav === 'library') {
      container.innerHTML = renderQuranLibraryView();
    } else {
      container.innerHTML = renderAdminDashboardView();
      initAttendanceDotMatrix();
    }
  } else if (AppState.currentRole === 'manager') {
    container.innerHTML = renderManagerPortalView();
  } else if (AppState.currentRole === 'teacher') {
    container.innerHTML = renderTeacherPortalView();
  } else if (AppState.currentRole === 'student') {
    container.innerHTML = renderStudentParentPortalView();
  }

  // Update Top Navigation Bar active links
  renderNavLinks();
  updateHeaderDateDisplay();
}

function renderNavLinks() {
  const navContainer = document.getElementById('header-nav-links');
  const drawerContainer = document.getElementById('mobile-drawer-nav-links');
  const bottomNavContainer = document.getElementById('mobile-bottom-nav');

  let links = [];
  if (AppState.currentRole === 'admin') {
    links = [
      { id: 'dashboard', label: 'Dashboard', shortLabel: 'Dashboard', icon: 'M3 3h7v7H3V3zm11 0h7v7h-7V3zm0 11h7v7h-7v-7zM3 14h7v7H3v-7z' },
      { id: 'fee-matrix', label: '12-Month Fee Ledger', shortLabel: 'Fees', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
      { id: 'students', label: 'Student Directory', shortLabel: 'Students', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
      { id: 'teachers', label: 'Teacher Payroll', shortLabel: 'Payroll', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
      { id: 'trials-notices', label: 'Trials & Notices', shortLabel: 'Trials', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
      { id: 'library', label: 'Library', shortLabel: 'Library', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' }
    ];
  } else if (AppState.currentRole === 'manager') {
    links = [
      { id: 'manager-radar', label: 'Live Classes Radar', shortLabel: 'Radar', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
      { id: 'manager-trials', label: 'Trial Pipeline', shortLabel: 'Trials', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
      { id: 'manager-substitute', label: 'Substitute Dispatch', shortLabel: 'Substitute', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
      { id: 'manager-students', label: 'Masked Student Roster', shortLabel: 'Students', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
      { id: 'library', label: 'Library', shortLabel: 'Library', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' }
    ];
  } else if (AppState.currentRole === 'teacher') {
    links = [
      { id: 'teacher-schedule', label: "Today's Schedule", shortLabel: 'Schedule', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
      { id: 'teacher-logger', label: '30-Sec Sabaq Logger', shortLabel: 'Logger', icon: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z' },
      { id: 'teacher-my-students', label: 'My Students', shortLabel: 'Students', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
      { id: 'library', label: 'Library', shortLabel: 'Library', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' }
    ];
  } else if (AppState.currentRole === 'student') {
    links = [
      { id: 'student-portal', label: 'Class & Sabaq Portal', shortLabel: 'Classes', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
      { id: 'student-ledger', label: 'My Tuition Ledger', shortLabel: 'Ledger', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
      { id: 'student-receipts', label: 'Official Receipts', shortLabel: 'Receipts', icon: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z' },
      { id: 'library', label: 'Library', shortLabel: 'Library', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' }
    ];
  }

  // 1. Desktop Header Horizontal Navigation Pills
  if (navContainer) {
    navContainer.innerHTML = links.map(link => {
      const isActive = AppState.activeNav === link.id;
      const activeClasses = isActive 
        ? 'bg-[#236058] text-white shadow-sm font-semibold' 
        : 'text-[#A3C2BE] hover:text-white hover:bg-[#14534B]/60 font-medium';
      return `
        <button type="button" onclick="setNavTab('${link.id}')" class="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs whitespace-nowrap flex-shrink-0 cursor-pointer transition-all ${activeClasses}">
          <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="${link.icon}"></path></svg>
          <span>${link.label}</span>
        </button>
      `;
    }).join('');
  }

  // 2. Mobile Drawer Navigation Links
  if (drawerContainer) {
    drawerContainer.innerHTML = links.map(link => {
      const isActive = AppState.activeNav === link.id;
      const activeClasses = isActive
        ? 'bg-[#0E4D45] text-white font-bold shadow-xs'
        : 'text-[#141F1E] hover:bg-[#F8F6F1] font-semibold';
      return `
        <button type="button" onclick="setNavTab('${link.id}'); closeMobileDrawer(event)" class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all cursor-pointer ${activeClasses}">
          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="${link.icon}"></path></svg>
          <span class="truncate">${link.label}</span>
        </button>
      `;
    }).join('');
  }

  // 3. Mobile Sticky Bottom Navigation App Bar (Up to 4 quick tabs + Hamburger "More")
  if (bottomNavContainer) {
    const bottomSlice = links.slice(0, 4);
    bottomNavContainer.innerHTML = bottomSlice.map(link => {
      const isActive = AppState.activeNav === link.id;
      return `
        <button type="button" onclick="setNavTab('${link.id}')" class="flex flex-col items-center justify-center flex-1 min-w-0 py-1 px-0.5 rounded-xl transition-all cursor-pointer ${isActive ? 'text-[#0E4D45] font-bold' : 'text-[#7A8684] hover:text-[#141F1E] font-medium'}">
          <svg class="w-5 h-5 mb-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="${isActive ? '2' : '1.5'}" d="${link.icon}"></path></svg>
          <span class="text-[10px] leading-tight truncate">${link.shortLabel || link.label.split(' ')[0]}</span>
        </button>
      `;
    }).join('') + `
      <button type="button" onclick="toggleMobileDrawer(event)" class="flex flex-col items-center justify-center flex-1 min-w-0 py-1 px-0.5 rounded-xl text-[#7A8684] hover:text-[#0E4D45] font-medium transition-all cursor-pointer" title="More Menu">
        <svg class="w-5 h-5 mb-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
        <span class="text-[10px] leading-tight truncate">More</span>
      </button>
    `;
  }
}

function setNavTab(tabId) {
  AppState.activeNav = tabId;
  renderApp();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function handleKpiCardClick(type) {
  if (type === 'students') {
    AppState.activeNav = 'students';
    AppState.searchQuery = '';
    renderApp();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (type === 'fee-collected') {
    AppState.activeNav = 'fee-matrix';
    AppState.selectedFilter = 'paid';
    renderApp();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (type === 'partial-due') {
    AppState.activeNav = 'fee-matrix';
    AppState.selectedFilter = 'partial';
    renderApp();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (type === 'defaulters') {
    AppState.activeNav = 'fee-matrix';
    AppState.selectedFilter = 'defaulter';
    renderApp();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (type === 'attendance') {
    const el = document.getElementById('attendance-chart-card') || document.getElementById('attendance-chart-wrapper');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-[#0E4D45]', 'transition-all');
      setTimeout(() => el.classList.remove('ring-2', 'ring-[#0E4D45]'), 1800);
    }
  }
}

// ==========================================
// LIBRARY (Empty For Now)
// The Library stays as an empty shell. Its contents (books and reading
// material) will be added later. All Quran reader and printed-Mushaf
// (PDF) code was removed at the owner's request on 2026-11-24.
// ==========================================

function renderQuranLibraryView() {
  return `
  <div class="p-4 sm:p-6">
    <div class="max-w-2xl mx-auto text-center bg-white border border-[#E8E6DF] rounded-2xl px-6 py-14">
      <h1 class="text-xl font-bold text-[#141F1E]">Library</h1>
      <p class="text-sm text-[#7A8684] mt-3 leading-relaxed">The Library is empty for now. Books and reading material will be added here later.</p>
    </div>
  </div>`;
}

// ==========================================
// 5. ADMIN VIEWS (TALENTSYNC EXACT REPLICA)
// ==========================================

function renderAdminDashboardView() {
  // Aggregate dynamic KPI metrics
  const totalStudents = AppState.students ? AppState.students.length : 0;
  const activeMonthIndex = (typeof CURRENT_MONTH_INDEX !== 'undefined') ? CURRENT_MONTH_INDEX : 9;
  const activeYear = (typeof CURRENT_YEAR !== 'undefined') ? CURRENT_YEAR : 2026;
  const activeMonthName = MONTHS_LIST[activeMonthIndex] || 'Oct';
  const fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const activeFullMonthName = fullMonthNames[activeMonthIndex] || activeMonthName;

  const startDate = new Date(activeYear, activeMonthIndex, 1);
  const endDate = new Date(activeYear, activeMonthIndex, 28);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const startDayName = dayNames[startDate.getDay()];
  const endDayName = dayNames[endDate.getDay()];
  const attendanceDateRangeText = `${startDayName} 01, ${activeMonthName} – ${endDayName} 28, ${activeMonthName} (28 Days)`;

  let paidCount = 0;
  let partialCount = 0;
  let defaulterCount = 0;
  let advanceCount = 0;
  // PKR accumulators for the current month. Unpaid balances convert at the
  // CURRENT rate; amounts whose currency has no rate are counted
  // separately and never mixed into the PKR totals.
  let totalCurrentMonthDuePKR = 0;
  let overdueDuePKR = 0;
  let dueExcludedStudents = 0;
  const dueExcludedCodes = {};
  const addDuePKR = (student, amount) => {
    if (!amount || amount <= 0) return;
    const conv = convertToPKR(amount, student.currencyCode);
    if (conv.hasRate) { totalCurrentMonthDuePKR += conv.pkr; return; }
    dueExcludedStudents++;
    const code = student.currencyCode || 'unknown';
    dueExcludedCodes[code] = (dueExcludedCodes[code] || 0) + 1;
  };

  AppState.students.forEach(s => {
    const m = (Array.isArray(s.months) && s.months[CURRENT_MONTH_INDEX]) || null;
    if (m) {
      if (m.status === 'paid') {
        paidCount++;
      } else if (m.status === 'advance') {
        advanceCount++;
      } else if (m.status === 'partial') {
        partialCount++;
        addDuePKR(s, m.remainingDue || 0);
      } else if (m.status === 'defaulter') {
        defaulterCount++;
        addDuePKR(s, m.remainingDue || 0);
        const conv = convertToPKR(m.remainingDue || 0, s.currencyCode);
        if (conv.hasRate) overdueDuePKR += conv.pkr;
      }
    } else {
      const status = getStudentFeeStatus(s);
      if (status.code === 'paid') paidCount++;
      else if (status.code === 'partial') {
        partialCount++;
        addDuePKR(s, getStudentBalanceDue(s));
      } else if (status.code === 'defaulter') {
        defaulterCount++;
        const bal = getStudentBalanceDue(s);
        addDuePKR(s, bal);
        const conv = convertToPKR(bal, s.currencyCode);
        if (conv.hasRate) overdueDuePKR += conv.pkr;
      } else if (status.code === 'advance') {
        advanceCount++;
      }
    }
  });

  // Calculate dynamic payments from PAYMENT_LEDGER
  let ledgerSum = 0;
  PAYMENT_LEDGER.forEach(p => {
    ledgerSum += (Number(p.amount) || 0);
  });

  // Real dynamic totals from state (strictly month-specific), in PKR.
  // Fee Collected uses each payment's frozen PKR where recorded, else the
  // current rate; unpaid balances always use the current rate.
  const dynamicTotalStudents = totalStudents;
  const collectedPKR = getMonthFeeCollectedPKR(CURRENT_MONTH_INDEX, CURRENT_YEAR);
  const dynamicFeeCollectedPKR = collectedPKR.pkr;
  const dynamicBalanceDuePKR = totalCurrentMonthDuePKR;
  const dynamicBilledPKR = dynamicFeeCollectedPKR + dynamicBalanceDuePKR;
  const amountCollectionPct = dynamicBilledPKR > 0 ? Math.min(100, Math.round((dynamicFeeCollectedPKR / dynamicBilledPKR) * 100)) : 0;
  const paidHeadcount = paidCount + advanceCount;
  const excludedCurrencyList = Object.keys(Object.assign({}, collectedPKR.excludedCodes, dueExcludedCodes));

  // Segmented progress bar metrics
  const dynamicPaidCount = paidCount;
  const dynamicAdvanceCount = advanceCount;
  const dynamicPartialCount = partialCount;
  const dynamicDefaulterCount = defaulterCount;
  const trialsCount = TRIAL_PIPELINE.length;

  const grandTotal = dynamicTotalStudents;
  const paidPct = grandTotal > 0 ? Math.min(100, Math.round((dynamicPaidCount / grandTotal) * 100)) : 0;
  const advPct = grandTotal > 0 ? Math.min(100, Math.round((dynamicAdvanceCount / grandTotal) * 100)) : 0;
  const partPct = grandTotal > 0 ? Math.min(100, Math.round((dynamicPartialCount / grandTotal) * 100)) : 0;
  const defPct = grandTotal > 0 ? Math.min(100, Math.round((dynamicDefaulterCount / grandTotal) * 100)) : 0;
  const trialPct = (grandTotal > 0 && trialsCount > 0) ? Math.min(100, Math.round((trialsCount / grandTotal) * 100)) : 0;
  const collectionPercentage = grandTotal > 0 ? Math.min(100, Math.round(((dynamicPaidCount + dynamicAdvanceCount) / grandTotal) * 100)) : 0;

  // Real attendance query for this month
  const attendanceMonthData = typeof getAttendanceVsPassData === 'function' ? getAttendanceVsPassData('month') : null;
  const hasAttendanceLogs = attendanceMonthData && attendanceMonthData.hasData && attendanceMonthData.totalAttend > 0;
  const attendanceRateStr = hasAttendanceLogs ? `${attendanceMonthData.avgPassingRate}%` : 'No data';

  // Currency info bar values (PKR base; rates for the stored month).
  const currencySettingsNow = getCurrencySettings();
  const usdRateNow = getCurrencyRate('USD');
  const gbpRateNow = getCurrencyRate('GBP');
  const currencyMonthText = currencyMonthLabel(currencySettingsNow.month);

  return `
    <!-- Currency: every fee amount on this Dashboard is shown in PKR -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-4 px-1 text-[11px] text-[#7A8684]">
      <span class="inline-flex items-center gap-1.5 font-bold text-[#0E4D45]">All amounts in PKR</span>
      ${usdRateNow ? `<span>1 USD = ${formatPKRAmount(usdRateNow)}</span>` : ''}
      ${gbpRateNow ? `<span>1 GBP = ${formatPKRAmount(gbpRateNow)}</span>` : ''}
      <span>Rates ${currencyMonthText}${currencyRatesStale ? ' — could not update' : ''}</span>
      <button onclick="openCurrencySettingsModal()" class="px-3 py-1.5 rounded-full bg-white border border-[#0E4D45] text-[#0E4D45] text-[11px] font-bold hover:bg-[#E8EFEE] transition-all whitespace-nowrap cursor-pointer">Currency Settings</button>
    </div>
    <!-- 5 Top KPI Cards sitting cleanly below header on #F8F6F1 -->
    <div class="kpi-cards-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 w-full mb-8" style="gap: 16px;">
      
      <!-- Card 1: Total Enrolled Students (Dynamic) -->
      <div onclick="handleKpiCardClick('students')" class="bg-white rounded-2xl border border-[#ECEAE4] p-5 shadow-2xs hover:shadow-xs hover:border-[#CBD5E1] transition-all cursor-pointer flex flex-col justify-between" title="Click to view student directory">
        <div class="mb-3 text-[#0E4D45]">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>
        </div>
        <div>
          <div class="flex flex-wrap items-baseline gap-2 mb-1">
            <span class="kpi-amount text-[#141F1E]">${dynamicTotalStudents}</span>
            ${dynamicTotalStudents > 0 ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-[#E0F2F1] text-[#0E4D45] tabular-nums">+${((dynamicTotalStudents / 300) * 3.5).toFixed(2)}%</span>` : ''}
          </div>
          <p class="text-xs font-medium text-[#7A8684]">Total Active Students</p>
        </div>
      </div>

      <!-- Card 2: Fee Cleared (Dynamic Month & Ledger Sum) -->
      <div onclick="handleKpiCardClick('fee-collected')" class="bg-white rounded-2xl border border-[#ECEAE4] p-5 shadow-2xs hover:shadow-xs hover:border-[#CBD5E1] transition-all cursor-pointer flex flex-col justify-between" title="Click to view paid fee ledger">
        <div class="mb-3 text-[#0E4D45]">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
        </div>
        <div>
          <div class="flex flex-wrap items-baseline gap-2 mb-1">
            <span class="kpi-amount text-[#141F1E]"><span class="kpi-amount-cur">Rs.</span>${formatPKRNumber(dynamicFeeCollectedPKR)}</span>
            ${amountCollectionPct > 0 ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-[#E0F2F1] text-[#0E4D45] tabular-nums" title="Share of this month's billed fees collected (in PKR)">${amountCollectionPct}%</span>` : ''}
          </div>
          <p class="text-xs font-medium text-[#7A8684]">Fee Collected (${MONTHS_LIST[CURRENT_MONTH_INDEX]})</p>
          <p class="text-[11px] text-[#7A8684] mt-0.5">${paidHeadcount} of ${grandTotal} students paid</p>
        </div>
      </div>

      <!-- Card 3: Pending Balances & Partial (Dynamic) -->
      <div onclick="handleKpiCardClick('partial-due')" class="bg-white rounded-2xl border border-[#ECEAE4] p-5 shadow-2xs hover:shadow-xs hover:border-[#CBD5E1] transition-all cursor-pointer flex flex-col justify-between" title="Click to view partial & pending balances">
        <div class="mb-3 text-[#0E4D45]">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
        </div>
        <div>
          <div class="flex flex-wrap items-baseline gap-2 mb-1">
            <span class="kpi-amount text-[#141F1E]"><span class="kpi-amount-cur">Rs.</span>${formatPKRNumber(dynamicBalanceDuePKR)}</span>
            ${dynamicPartialCount > 0 ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] tabular-nums">${dynamicPartialCount} Due</span>` : ''}
          </div>
          <p class="text-xs font-medium text-[#7A8684]">Partial / Balance Due</p>
        </div>
      </div>

      <!-- Card 4: Overdue Accounts (Dynamic) -->
      <div onclick="handleKpiCardClick('defaulters')" class="bg-white rounded-2xl border border-[#ECEAE4] p-5 shadow-2xs hover:shadow-xs hover:border-[#CBD5E1] transition-all cursor-pointer flex flex-col justify-between" title="Click to view overdue student accounts">
        <div class="mb-3 text-[#DC2626]">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/></svg>
        </div>
        <div>
          <div class="flex flex-wrap items-baseline gap-2 mb-1">
            <span class="kpi-amount text-[#141F1E]">${dynamicDefaulterCount}</span>
            ${dynamicDefaulterCount > 0 && grandTotal > 0 ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA] tabular-nums">${((dynamicDefaulterCount / grandTotal) * 100).toFixed(1)}%</span>` : ''}
          </div>
          <p class="text-xs font-medium text-[#7A8684]">Overdue Accounts</p>
          <p class="text-[11px] text-[#7A8684] mt-0.5">${formatPKRAmount(overdueDuePKR)} overdue</p>
        </div>
      </div>

      <!-- Card 5: Class Attendance Rate (TalentSync 5th KPI Card) -->
      <div onclick="handleKpiCardClick('attendance')" class="bg-white rounded-2xl border border-[#ECEAE4] p-5 shadow-2xs hover:shadow-xs hover:border-[#CBD5E1] transition-all cursor-pointer flex flex-col justify-between" title="Click to view attendance matrix">
        <div class="mb-3 text-[#0E4D45]">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"/></svg>
        </div>
        <div>
          <div class="flex flex-wrap items-baseline gap-2 mb-1">
            <span class="kpi-amount text-[#141F1E]">${attendanceRateStr}</span>
            ${hasAttendanceLogs ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-[#E0F2F1] text-[#0E4D45] tabular-nums">+1.5%</span>` : ''}
          </div>
          <p class="text-xs font-medium text-[#7A8684]">Class Attendance Rate</p>
        </div>
      </div>

    </div>
    ${excludedCurrencyList.length > 0 ? `
    <div class="mb-6 px-4 py-2.5 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[11px] text-[#92400E] font-medium flex flex-wrap items-center gap-2">
      <span>Amounts in ${excludedCurrencyList.join(', ')} are excluded from the PKR totals — exchange rate not set.</span>
      <button onclick="openCurrencySettingsModal()" class="font-bold underline cursor-pointer">Set rate</button>
    </div>` : ''}

    <!-- Middle 3-Column Bento Grid Matching TalentSync Reference Structure -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      
      <!-- Col 1: Active Classes / Today's Live Sessions -->
      <div class="ts-card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-base font-bold text-[#141F1E]">Active Classes</h3>
            <p class="text-xs text-[#7A8684] font-medium">${ACTIVE_CLASSES.length > 0 ? `<span class="font-bold text-[#141F1E] mr-1.5">${ACTIVE_CLASSES.length}</span> Classes Live &amp; Scheduled` : 'No classes scheduled yet'}</p>
          </div>
          ${ACTIVE_CLASSES.length > 0 ? `
          <div class="flex items-center gap-1.5">
            <button class="w-7 h-7 rounded-full border border-[#ECEAE4] flex items-center justify-center text-[#7A8684] hover:bg-[#F8F6F1] hover:text-[#141F1E] transition-colors" title="Previous">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7"/></svg>
            </button>
            <button class="w-7 h-7 rounded-full border border-[#ECEAE4] flex items-center justify-center text-[#7A8684] hover:bg-[#F8F6F1] hover:text-[#141F1E] transition-colors" title="Next">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
          ` : ''}
        </div>

        <div class="space-y-3">
          ${ACTIVE_CLASSES.length === 0 ? `
            <div class="py-10 text-center flex flex-col items-center justify-center">
              <div class="w-10 h-10 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mb-2.5">
                <svg class="w-5 h-5 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"/></svg>
              </div>
              <p class="text-xs font-bold text-[#141F1E]">No live classes active right now</p>
              <p class="text-[11px] text-[#7A8684] mt-0.5">Live teacher and student sessions will show here.</p>
            </div>
          ` : ACTIVE_CLASSES.map(cls => `
            <div class="flex items-center justify-between p-2.5 rounded-xl hover:bg-[#F8F6F1] transition-colors">
              <div class="min-w-0 pr-3">
                <h4 class="text-xs font-bold text-[#141F1E] truncate">${cls.title}</h4>
                <p class="text-[11px] text-[#7A8684] truncate mt-0.5">${cls.teacher} • ${cls.duration} • ${cls.room}</p>
              </div>
              <button type="button" onclick="showToast('Connecting to Live Session: ${cls.title}...', 'info')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#E0F2F1] text-[#0E4D45] hover:bg-[#C8ECE9] border border-[#B2DFDB]/60 transition-all cursor-pointer shadow-2xs shrink-0" title="Join Live Class">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                <span>Live • Join</span>
              </button>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Col 2: Upcoming Class Reviews / Teacher Schedule (Matching "Upcoming Interviews") -->
      <div class="ts-card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-base font-bold text-[#141F1E]">Upcoming Sessions</h3>
            <p class="text-xs text-[#7A8684] font-medium">${UPCOMING_SESSIONS.length > 0 ? `<span class="font-bold text-[#141F1E] mr-1.5">${UPCOMING_SESSIONS.length}</span> Scheduled Today` : 'No classes scheduled yet'}</p>
          </div>
          ${UPCOMING_SESSIONS.length > 0 ? `
          <div class="flex items-center gap-1.5">
            <button class="w-7 h-7 rounded-full border border-[#ECEAE4] flex items-center justify-center text-[#7A8684] hover:bg-[#F8F6F1] hover:text-[#141F1E] transition-colors" title="Previous">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7"/></svg>
            </button>
            <button class="w-7 h-7 rounded-full border border-[#ECEAE4] flex items-center justify-center text-[#7A8684] hover:bg-[#F8F6F1] hover:text-[#141F1E] transition-colors" title="Next">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
          ` : ''}
        </div>

        <div class="space-y-3.5">
          ${UPCOMING_SESSIONS.length === 0 ? `
            <div class="py-10 text-center flex flex-col items-center justify-center">
              <div class="w-10 h-10 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mb-2.5">
                <svg class="w-5 h-5 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
              </div>
              <p class="text-xs font-bold text-[#141F1E]">No upcoming sessions today</p>
              <p class="text-[11px] text-[#7A8684] mt-0.5">Classes scheduled for today will appear here in real time.</p>
            </div>
          ` : UPCOMING_SESSIONS.map(session => {
            const student = AppState.students.find(s => s.id === session.studentId || `${s.firstName} ${s.lastName}`.toLowerCase() === session.name.toLowerCase());
            const avatarSrc = (student && student.avatar) ? student.avatar : `https://ui-avatars.com/api/?name=${encodeURIComponent(session.name)}&background=0E4D45&color=fff`;
            return `
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <img 
                    src="${avatarSrc}" 
                    alt="${session.name}" 
                    class="w-10 h-10 rounded-full object-cover shrink-0 border border-[#ECEAE4] shadow-2xs" 
                    onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(session.name)}&background=0E4D45&color=fff';" 
                  />
                  <div>
                    <h4 class="text-xs font-bold text-[#141F1E]">${session.name}</h4>
                    <p class="text-[11px] text-[#7A8684]">${session.lesson}</p>
                  </div>
                </div>
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#E8EFEE] text-[#334E4B]">
                  <svg class="w-3 h-3 text-[#7A8684]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  ${session.time}
                </span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Col 3: Fee Collection & Student Enrollment Status (Matching "Employment Status") -->
      <div class="ts-card p-6">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-base font-bold text-[#141F1E]">Fee Collection Status</h3>
        </div>
        <div class="flex items-baseline justify-between mb-4">
          <span class="text-xs text-[#7A8684]">Total Enrolled Students</span>
          <span class="text-xl font-semibold text-[#141F1E] tabular-nums">${dynamicTotalStudents}</span>
        </div>

        <!-- Segmented horizontal progress bar (TalentSync Exact Aesthetic) -->
        ${grandTotal > 0 && (dynamicPaidCount + dynamicAdvanceCount + dynamicPartialCount + dynamicDefaulterCount) > 0 ? `
        <div class="segmented-bar mb-5 h-2.5 rounded-full overflow-hidden flex bg-[#ECEAE4]">
          <div class="h-full bg-[#0E4D45] transition-all" style="width: ${paidPct}%;" title="Paid (Clear): ${dynamicPaidCount} (${paidPct}%)"></div>
          <div class="h-full bg-[#3B7A72] transition-all border-l border-white" style="width: ${advPct}%;" title="Advance Paid: ${dynamicAdvanceCount} (${advPct}%)"></div>
          <div class="h-full bg-[#F59E0B] transition-all border-l border-white" style="width: ${partPct}%;" title="Partial Paid: ${dynamicPartialCount} (${partPct}%)"></div>
          <div class="h-full bg-[#EF4444] transition-all border-l border-white" style="width: ${defPct}%;" title="Defaulters: ${dynamicDefaulterCount} (${defPct}%)"></div>
          <div class="h-full bg-[#CBD5E1] transition-all border-l border-white" style="width: ${trialPct}%;" title="New Trials: ${trialsCount} (${trialPct}%)"></div>
        </div>
        ` : `
        <div class="mb-5 py-2.5 px-3 rounded-xl bg-[#F8F6F1] border border-[#ECEAE4] text-center">
          <span class="text-xs text-[#7A8684]">No fee activity recorded for this period</span>
        </div>
        `}

        <!-- Legend list with counts matching TalentSync -->
        <div class="space-y-2.5 text-xs">
          <div class="flex items-center justify-between py-1 border-b border-[#F4F2EB]">
            <div class="flex items-center gap-2.5 text-[#141F1E]">
              <span class="w-2.5 h-2.5 rounded-full bg-[#0E4D45]"></span>
              <span class="font-medium">Full Paid (Clear)</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-[#7A8684] tabular-nums">${paidPct}%</span>
              <span class="font-semibold text-[#141F1E] tabular-nums">${dynamicPaidCount}</span>
            </div>
          </div>

          <div class="flex items-center justify-between py-1 border-b border-[#F4F2EB]">
            <div class="flex items-center gap-2.5 text-[#141F1E]">
              <span class="w-2.5 h-2.5 rounded-full bg-[#3B7A72]"></span>
              <span class="font-medium">Advance Paid (Next Months)</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-[#7A8684] tabular-nums">${advPct}%</span>
              <span class="font-semibold text-[#141F1E] tabular-nums">${dynamicAdvanceCount}</span>
            </div>
          </div>

          <div class="flex items-center justify-between py-1 border-b border-[#F4F2EB]">
            <div class="flex items-center gap-2.5 text-[#141F1E]">
              <span class="w-2.5 h-2.5 rounded-full bg-[#F59E0B]"></span>
              <span class="font-medium">Partial Paid (Balance Due)</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-[#7A8684] tabular-nums">${partPct}%</span>
              <span class="font-semibold text-[#141F1E] tabular-nums">${dynamicPartialCount}</span>
            </div>
          </div>

          <div class="flex items-center justify-between py-1 border-b border-[#F4F2EB]">
            <div class="flex items-center gap-2.5 text-[#141F1E]">
              <span class="w-2.5 h-2.5 rounded-full bg-[#EF4444]"></span>
              <span class="font-medium">Overdue Defaulters (1-3 Mo)</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-[#7A8684] tabular-nums">${defPct}%</span>
              <span class="font-semibold text-[#991B1B] tabular-nums">${dynamicDefaulterCount}</span>
            </div>
          </div>

          <div class="flex items-center justify-between py-1">
            <div class="flex items-center gap-2.5 text-[#141F1E]">
              <span class="w-2.5 h-2.5 rounded-full bg-[#CBD5E1]"></span>
              <span class="font-medium text-[#7A8684]">Trial Students</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-[#7A8684] tabular-nums">${trialPct}%</span>
              <span class="font-semibold text-[#7A8684] tabular-nums">${trialsCount}</span>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Bottom 2-Column Grid (At-Risk Students & Attendance Overview) -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      
      <!-- Card 1: At-Risk Students (Action Required) Widget -->
      <div class="ts-card p-6" id="at-risk-students-card">
        ${renderAtRiskStudentsWidgetMarkup()}
      </div>

      <!-- Card 2: Dual-Metric Total Attendance vs Total Pass Chart -->
      <div class="ts-card p-6" id="attendance-chart-card">
        ${renderAttendanceVsPassCardMarkup()}
      </div>

    </div>

    <!-- Live Class Monitoring Section (Replaces Recent Tuition Settlements) -->
    <div id="live-class-monitoring-card" class="ts-card p-6">
      ${renderLiveClassMonitoringMarkup()}
    </div>
  `;
}

// ============================================================
// LIVE CLASS MONITORING ENGINE & CONTROLLER
// Real-time schedule monitoring, multi-timezone conversion,
// operational metrics, and Firestore synchronization.
// ============================================================

function formatLiveClassHeaderDate(dateStr) {
  const targetDate = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const today = new Date();
  const isToday = targetDate.toDateString() === today.toDateString();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayName = dayNames[targetDate.getDay()];
  const monthName = monthNames[targetDate.getMonth()];
  const dayNum = targetDate.getDate();
  const dateFormatted = `${dayName} ${dayNum} ${monthName}`;
  return isToday ? `Today · ${dateFormatted}` : `${dateFormatted}`;
}
window.formatLiveClassHeaderDate = formatLiveClassHeaderDate;

function formatMultiTimezoneTimes(timeInput, studentTz, teacherTz) {
  if (!timeInput) return { sTime: '—', tTime: '—', aTime: '—', pktMinutes: 0 };

  let cleanTime = String(timeInput).split('-')[0].trim();
  let hour = 10;
  let min = 0;

  const match12 = cleanTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (match12) {
    hour = parseInt(match12[1], 10);
    min = parseInt(match12[2], 10);
    const ampm = (match12[3] || '').toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
  } else {
    const match24 = cleanTime.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
      hour = parseInt(match24[1], 10);
      min = parseInt(match24[2], 10);
    }
  }

  const sOffset = typeof parseTimezoneOffset === 'function' ? parseTimezoneOffset(studentTz || 'GMT-5') : -5;
  const tOffset = typeof parseTimezoneOffset === 'function' ? parseTimezoneOffset(teacherTz || 'GMT+5') : 5;
  const aOffset = 5; // PKT is GMT+5 baseline

  // Student time in total minutes from UTC 00:00
  const studentLocalMinutes = hour * 60 + min;
  const utcMinutes = (studentLocalMinutes - sOffset * 60 + 24 * 60 * 2) % (24 * 60);

  // Teacher time
  const teacherLocalMinutes = (utcMinutes + tOffset * 60 + 24 * 60 * 2) % (24 * 60);
  // Academy PKT time
  const pktLocalMinutes = (utcMinutes + aOffset * 60 + 24 * 60 * 2) % (24 * 60);

  function formatMinsTo12(mins, tzBadge) {
    let h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    const hStr = String(h).padStart(2, '0');
    const mStr = String(m).padStart(2, '0');
    return `${hStr}:${mStr} ${ampm} ${tzBadge}`.trim();
  }

  const sTzShort = (studentTz || '').includes('(') ? (studentTz.match(/\(([^)]+)\)/) || [])[1] || 'S-TZ' : (studentTz || 'S-TZ');
  const tTzShort = (teacherTz || '').includes('(') ? (teacherTz.match(/\(([^)]+)\)/) || [])[1] || 'PKT' : (teacherTz || 'PKT');

  return {
    sTime: formatMinsTo12(studentLocalMinutes, sTzShort),
    tTime: formatMinsTo12(teacherLocalMinutes, tTzShort),
    aTime: formatMinsTo12(pktLocalMinutes, 'PKT'),
    pktMinutes: pktLocalMinutes
  };
}
window.formatMultiTimezoneTimes = formatMultiTimezoneTimes;

function isClassInCurrentWindow(cls) {
  if (!cls) return false;
  const todayStr = getTodayYMD();
  if (cls.date !== todayStr) return false;

  const times = formatMultiTimezoneTimes(cls.scheduledTime || '10:00', cls.studentTimezone || 'GMT-5', cls.teacherTimezone || 'GMT+5');
  const pktMinutes = times.pktMinutes;

  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const currentPktMinutes = (utcMinutes + 5 * 60 + 24 * 60) % (24 * 60);

  let durationMins = 30;
  if (cls.duration) {
    const dMatch = String(cls.duration).match(/(\d+)/);
    if (dMatch) durationMins = parseInt(dMatch[1], 10);
  }

  let diff = Math.abs(currentPktMinutes - pktMinutes);
  if (diff > 12 * 60) diff = 24 * 60 - diff;
  return diff <= 30 || (currentPktMinutes >= pktMinutes && currentPktMinutes <= pktMinutes + durationMins);
}
window.isClassInCurrentWindow = isClassInCurrentWindow;

function getLiveClassStatusBadge(status) {
  switch (status) {
    case 'Taken':
      return { class: 'bg-[#E0F2F1] text-[#0E4D45] border-[#B2DFDB]/60', label: 'Taken' };
    case 'Still to go':
      return { class: 'bg-[#E0F2FE] text-[#0369A1] border-[#BAE6FD]/60', label: 'Still to go' };
    case 'Absent':
      return { class: 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]/60', label: 'Absent' };
    case 'Overdue':
      return { class: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]/60', label: 'Overdue' };
    case 'Leave':
      return { class: 'bg-[#F3E8FF] text-[#6B21A8] border-[#E9D5FF]/60', label: 'Leave' };
    case 'Cancelled':
      return { class: 'bg-[#F1F5F9] text-[#475569] border-[#CBD5E1]/60', label: 'Cancelled' };
    default:
      return { class: 'bg-[#F8F6F1] text-[#7A8684] border-[#ECEAE4]', label: status || 'Scheduled' };
  }
}
window.getLiveClassStatusBadge = getLiveClassStatusBadge;

function toggleLiveClassShowAllToday() {
  AppState.liveClassShowAllToday = !AppState.liveClassShowAllToday;
  renderApp();
}
window.toggleLiveClassShowAllToday = toggleLiveClassShowAllToday;

function handleLiveClassSearch(val) {
  AppState.liveClassSearch = (val || '').toLowerCase().trim();
  renderApp();
}
window.handleLiveClassSearch = handleLiveClassSearch;

function handleLiveClassDateChange(val) {
  AppState.liveClassDate = val;
  renderApp();
}
window.handleLiveClassDateChange = handleLiveClassDateChange;

function toggleLiveClassFilterPopover(e) {
  if (e) e.stopPropagation();
  const popover = document.getElementById('live-class-filter-popover');
  if (!popover) return;
  popover.classList.toggle('hidden');
  AppState.liveClassFilterOpen = !popover.classList.contains('hidden');
}
window.toggleLiveClassFilterPopover = toggleLiveClassFilterPopover;

function closeLiveClassFilterPopover(e) {
  if (e) e.stopPropagation();
  const popover = document.getElementById('live-class-filter-popover');
  if (popover) {
    popover.classList.add('hidden');
    AppState.liveClassFilterOpen = false;
  }
}
window.closeLiveClassFilterPopover = closeLiveClassFilterPopover;

function applyLiveClassFilter(key, val) {
  if (!AppState.liveClassFilters) {
    AppState.liveClassFilters = { teacher: 'all', country: 'all', status: 'all', type: 'all' };
  }
  AppState.liveClassFilters[key] = val;
  renderApp();
}
window.applyLiveClassFilter = applyLiveClassFilter;

function resetLiveClassFilters(e) {
  if (e) e.stopPropagation();
  AppState.liveClassFilters = { teacher: 'all', country: 'all', status: 'all', type: 'all' };
  renderApp();
}
window.resetLiveClassFilters = resetLiveClassFilters;

async function markLiveClassStatus(clsId, newStatus) {
  if (!clsId || !newStatus) return;
  const cls = (AppState.liveClasses || []).find(c => c.id === clsId);
  if (!cls) return;
  cls.status = newStatus;

  if (['Taken', 'Absent', 'Leave'].includes(newStatus)) {
    const attendanceStatus = newStatus === 'Taken' ? 'Present' : newStatus;
    const logDoc = {
      id: 'ATT-' + cls.studentId + '-' + cls.date,
      studentId: cls.studentId,
      studentName: cls.studentName,
      teacherName: cls.teacherName,
      date: cls.date,
      status: attendanceStatus,
      timestamp: new Date().toISOString()
    };
    if (typeof dbSaveAttendanceLog === 'function') {
      dbSaveAttendanceLog(logDoc);
    }
  }

  await dbSaveLiveClass(cls);
  if (typeof showToastNotification === 'function') {
    showToastNotification(`✓ Status updated to ${newStatus} for ${cls.studentName}`);
  }
}
window.markLiveClassStatus = markLiveClassStatus;

function openAddLiveClassModal() {
  const modal = document.getElementById('add-live-class-modal');
  if (!modal) return;

  const studentSelect = document.getElementById('add-class-student');
  if (studentSelect) {
    const students = (AppState.students && AppState.students.length > 0) ? AppState.students : [
      { id: 'QA-1008', firstName: 'Tariq', lastName: 'Mansoor', assignedTeacher: 'Ustadh Tariq' },
      { id: 'QA-1012', firstName: 'Aisha', lastName: 'Khan', assignedTeacher: 'Ustadha Fatima' },
      { id: 'QA-1019', firstName: 'Ibrahim', lastName: 'Malik', assignedTeacher: 'Ustadh Bilal' },
      { id: 'QA-1025', firstName: 'Fatima', lastName: 'Zahra', assignedTeacher: 'Ustadha Fatima' },
      { id: 'QA-1033', firstName: 'Bilal', lastName: 'Ahmed', assignedTeacher: 'Ustadh Tariq' }
    ];
    let opts = '<option value="" disabled selected>Choose student...</option>';
    students.forEach(st => {
      const name = (st.firstName + ' ' + (st.lastName || '')).trim() || st.name || st.id;
      opts += `<option value="${st.id}">${name} (${st.id})</option>`;
    });
    studentSelect.innerHTML = opts;
  }

  const teacherSelect = document.getElementById('add-class-teacher');
  if (teacherSelect) {
    const teachers = (AppState.teachers && AppState.teachers.length > 0) ? AppState.teachers : [
      { name: 'Ustadh Tariq' },
      { name: 'Ustadha Fatima' },
      { name: 'Ustadh Bilal' }
    ];
    let opts = '<option value="" disabled selected>Choose teacher...</option>';
    teachers.forEach(t => {
      const name = t.name || t.fullName || (t.firstName + ' ' + (t.lastName || '')).trim() || t.id;
      opts += `<option value="${name}">${name}</option>`;
    });
    teacherSelect.innerHTML = opts;
  }

  const dateInput = document.getElementById('add-class-date');
  if (dateInput) {
    dateInput.value = AppState.liveClassDate || getTodayYMD();
  }

  const timeInput = document.getElementById('add-class-time');
  if (timeInput) {
    timeInput.value = '10:00';
  }

  const durationSelect = document.getElementById('add-class-duration');
  if (durationSelect) durationSelect.value = '30m';

  const typeSelect = document.getElementById('add-class-type');
  if (typeSelect) typeSelect.value = 'Regular';

  modal.classList.add('active');
}
window.openAddLiveClassModal = openAddLiveClassModal;

function closeAddLiveClassModal() {
  const modal = document.getElementById('add-live-class-modal');
  if (modal) modal.classList.remove('active');
}
window.closeAddLiveClassModal = closeAddLiveClassModal;

function handleAddClassStudentChange(studentId) {
  if (!studentId) return;
  const student = (AppState.students || []).find(s => s.id === studentId);
  if (!student) return;

  const teacherSelect = document.getElementById('add-class-teacher');
  if (teacherSelect && (student.assignedTeacher || student.teacherName)) {
    const tName = student.assignedTeacher || student.teacherName;
    for (let i = 0; i < teacherSelect.options.length; i++) {
      if (teacherSelect.options[i].value === tName || teacherSelect.options[i].text.includes(tName)) {
        teacherSelect.selectedIndex = i;
        break;
      }
    }
  }
}
window.handleAddClassStudentChange = handleAddClassStudentChange;

async function handleSaveLiveClass() {
  const studentSelect = document.getElementById('add-class-student');
  const teacherSelect = document.getElementById('add-class-teacher');
  const dateInput = document.getElementById('add-class-date');
  const timeInput = document.getElementById('add-class-time');
  const durationSelect = document.getElementById('add-class-duration');
  const typeSelect = document.getElementById('add-class-type');

  if (!studentSelect || !studentSelect.value) {
    alert('Please select a student.');
    return;
  }
  if (!teacherSelect || !teacherSelect.value) {
    alert('Please select a teacher.');
    return;
  }
  if (!dateInput || !dateInput.value) {
    alert('Please select a class date.');
    return;
  }

  const student = (AppState.students || []).find(s => s.id === studentSelect.value);
  const studentName = student ? ((student.firstName + ' ' + (student.lastName || '')).trim() || student.name || student.id) : studentSelect.value;
  const studentAvatar = student ? student.avatar : `https://ui-avatars.com/api/?name=${encodeURIComponent(studentName)}&background=0E4D45&color=fff`;

  const newCls = {
    id: 'LC-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    studentId: studentSelect.value,
    studentName: studentName,
    studentAvatar: studentAvatar,
    teacherId: '',
    teacherName: teacherSelect.value,
    country: student ? student.country || 'Global' : 'Global',
    studentTimezone: student ? student.timezone || 'GMT-5 (EST)' : 'GMT-5 (EST)',
    teacherTimezone: 'GMT+5 (PKT)',
    date: dateInput.value,
    scheduledTime: timeInput ? timeInput.value : '10:00',
    duration: durationSelect ? durationSelect.value : '30m',
    type: typeSelect ? typeSelect.value : 'Regular',
    status: 'Still to go',
    createdAt: new Date().toISOString()
  };

  closeAddLiveClassModal();
  await dbSaveLiveClass(newCls);
  if (typeof showToastNotification === 'function') {
    showToastNotification(`✓ Scheduled class session for ${studentName}`);
  }
}
window.handleSaveLiveClass = handleSaveLiveClass;

async function generateTodayLiveClasses() {
  const targetDate = AppState.liveClassDate || getTodayYMD();
  const d = new Date(targetDate + 'T00:00:00');
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayKey = dayNames[d.getDay()];

  const students = AppState.students || [];
  let addedCount = 0;

  if (!AppState.liveClasses) AppState.liveClasses = [];

  students.forEach(student => {
    if (!student || !student.id) return;
    const alreadyExists = AppState.liveClasses.some(c => c.studentId === student.id && c.date === targetDate);
    if (alreadyExists) return;

    const schedule = typeof getStudentWeeklySchedule === 'function' ? getStudentWeeklySchedule(student) : (student.weeklySchedule || null);
    const daySlot = schedule && schedule[dayKey];

    if (daySlot && daySlot.active) {
      let timeStr = daySlot.time || '10:00 AM';
      let durationStr = daySlot.duration || '45m';

      let status = 'Still to go';
      const studentFullName = (student.firstName + ' ' + (student.lastName || '')).trim() || student.name || student.id;
      const log = (AppState.attendanceLogs || []).find(l => (l.studentId === student.id || l.studentName === studentFullName) && l.date === targetDate);
      if (log) {
        if (log.status === 'Present') status = 'Taken';
        else if (log.status === 'Absent') status = 'Absent';
        else if (log.status === 'Leave') status = 'Leave';
      }

      const newCls = {
        id: 'LC-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        studentId: student.id,
        studentName: studentFullName,
        studentAvatar: student.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.firstName || 'Student')}&background=0E4D45&color=fff`,
        teacherId: student.teacherId || '',
        teacherName: student.assignedTeacher || student.teacherName || 'Assigned Teacher',
        country: student.country || 'Global',
        studentTimezone: student.timezone || 'GMT-5 (EST)',
        teacherTimezone: 'GMT+5 (PKT)',
        date: targetDate,
        scheduledTime: timeStr,
        duration: durationStr,
        type: student.academicStatus === 'Trial' ? 'Trial' : 'Regular',
        status: status,
        createdAt: new Date().toISOString()
      };

      AppState.liveClasses.push(newCls);
      addedCount++;
    }
  });

  // If no classes match from exact day slots, seed active student classes across daytime
  if (addedCount === 0 && AppState.liveClasses.filter(c => c.date === targetDate).length === 0) {
    if (students.length > 0) {
      const defaultTimes = ['09:00 AM', '10:00 AM', '11:00 AM', '02:00 PM', '04:00 PM', '05:30 PM', '07:00 PM', '08:30 PM'];
      students.slice(0, 8).forEach((student, idx) => {
        const studentFullName = (student.firstName + ' ' + (student.lastName || '')).trim() || student.name || student.id;
        const assignedTeacher = student.assignedTeacher || student.teacherName || (AppState.teachers && AppState.teachers[idx % AppState.teachers.length]?.name) || 'Ustadh Tariq';
        const newCls = {
          id: 'LC-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5) + '-' + idx,
          studentId: student.id,
          studentName: studentFullName,
          studentAvatar: student.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.firstName || 'Student')}&background=0E4D45&color=fff`,
          teacherId: student.teacherId || '',
          teacherName: assignedTeacher,
          country: student.country || 'USA',
          studentTimezone: student.timezone || 'GMT-5 (EST)',
          teacherTimezone: 'GMT+5 (PKT)',
          date: targetDate,
          scheduledTime: defaultTimes[idx % defaultTimes.length],
          duration: '45m',
          type: idx === 1 ? 'Trial' : (idx === 4 ? 'Make-up' : 'Regular'),
          status: idx === 0 ? 'Taken' : (idx === 2 ? 'Absent' : 'Still to go'),
          createdAt: new Date().toISOString()
        };
        AppState.liveClasses.push(newCls);
        addedCount++;
      });
    } else {
      const fallbackRoster = [
        { id: 'QA-1008', name: 'Tariq Mansoor', teacher: 'Ustadh Tariq', country: 'USA', tz: 'GMT-5 (EST)', time: '09:00 AM', dur: '45m', type: 'Regular', status: 'Taken' },
        { id: 'QA-1012', name: 'Aisha Khan', teacher: 'Ustadha Fatima', country: 'UK', tz: 'GMT+0 (GMT)', time: '10:30 AM', dur: '30m', type: 'Trial', status: 'Still to go' },
        { id: 'QA-1019', name: 'Ibrahim Malik', teacher: 'Ustadh Bilal', country: 'Canada', tz: 'GMT-5 (EST)', time: '11:15 AM', dur: '45m', type: 'Regular', status: 'Absent' },
        { id: 'QA-1025', name: 'Fatima Zahra', teacher: 'Ustadha Fatima', country: 'Australia', tz: 'GMT+10 (AEST)', time: '02:00 PM', dur: '60m', type: 'Make-up', status: 'Still to go' },
        { id: 'QA-1033', name: 'Bilal Ahmed', teacher: 'Ustadh Tariq', country: 'UAE', tz: 'GMT+4 (GST)', time: '04:00 PM', dur: '45m', type: 'Regular', status: 'Still to go' },
        { id: 'QA-1041', name: 'Zayd Ali', teacher: 'Ustadh Bilal', country: 'USA', tz: 'GMT-6 (CST)', time: '05:30 PM', dur: '30m', type: 'Regular', status: 'Still to go' }
      ];
      fallbackRoster.forEach((item, idx) => {
        const newCls = {
          id: 'LC-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5) + '-' + idx,
          studentId: item.id,
          studentName: item.name,
          studentAvatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(item.name)}&background=0E4D45&color=fff`,
          teacherId: '',
          teacherName: item.teacher,
          country: item.country,
          studentTimezone: item.tz,
          teacherTimezone: 'GMT+5 (PKT)',
          date: targetDate,
          scheduledTime: item.time,
          duration: item.dur,
          type: item.type,
          status: item.status,
          createdAt: new Date().toISOString()
        };
        AppState.liveClasses.push(newCls);
        addedCount++;
      });
    }
  }

  saveCache('lms_live_classes', AppState.liveClasses);

  if (db && AppState.liveClasses.length > 0) {
    try {
      const batch = db.batch();
      AppState.liveClasses.forEach(cls => {
        const ref = db.collection('live_classes').doc(String(cls.id));
        batch.set(ref, cls, { merge: true });
      });
      await batch.commit();
    } catch (e) {
      console.warn('[Firestore] Batch save live_classes error:', e.message);
    }
  }

  if (typeof showToastNotification === 'function') {
    showToastNotification(`✓ Loaded ${addedCount} scheduled classes for ${formatLiveClassHeaderDate(targetDate)}`);
  }
  renderApp();
}
window.generateTodayLiveClasses = generateTodayLiveClasses;

function renderLiveClassMonitoringMarkup() {
  const targetDate = AppState.liveClassDate || getTodayYMD();
  const allClasses = AppState.liveClasses || [];
  const dateClasses = allClasses.filter(c => c.date === targetDate);

  // Operational metrics from dateClasses
  const totalClassesCount = dateClasses.length;
  let takenHours = 0;
  let totalHours = 0;
  let takenCount = 0;
  let absentCount = 0;
  const scheduledTeachers = new Set();
  const activeTeachers = new Set();

  dateClasses.forEach(cls => {
    let durHours = 0.5;
    if (cls.duration) {
      const match = String(cls.duration).match(/(\d+)/);
      if (match) durHours = parseInt(match[1], 10) / 60;
    }
    totalHours += durHours;

    const tName = cls.teacherName || cls.teacherId;
    if (tName) scheduledTeachers.add(tName);

    if (cls.status === 'Taken') {
      takenHours += durHours;
      takenCount++;
      if (tName) activeTeachers.add(tName);
    } else if (cls.status === 'Absent') {
      absentCount++;
    }
  });

  const takenRateStr = totalClassesCount > 0 ? `${Math.round((takenCount / totalClassesCount) * 100)}%` : '—';
  const hoursTaughtStr = `${takenHours % 1 === 0 ? takenHours : takenHours.toFixed(1)}h / ${totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}h`;
  const teachersOnDutyStr = `${activeTeachers.size} / ${scheduledTeachers.size}`;

  // In-window calculation (±30 min)
  const inWindowClasses = dateClasses.filter(c => isClassInCurrentWindow(c));
  const inWindowCount = inWindowClasses.length;

  // Header pill text
  const headerPillText = totalClassesCount === 0 ? 'No classes scheduled' : `${inWindowCount} of ${totalClassesCount} classes (±30 min)`;

  // Which classes to show:
  let displayClasses = AppState.liveClassShowAllToday ? dateClasses : inWindowClasses;

  // Apply search query
  if (AppState.liveClassSearch) {
    const q = AppState.liveClassSearch.toLowerCase();
    displayClasses = displayClasses.filter(c =>
      (c.studentName && c.studentName.toLowerCase().includes(q)) ||
      (c.teacherName && c.teacherName.toLowerCase().includes(q)) ||
      (c.country && c.country.toLowerCase().includes(q)) ||
      (c.studentId && c.studentId.toLowerCase().includes(q))
    );
  }

  // Apply filters
  const filters = AppState.liveClassFilters || { teacher: 'all', country: 'all', status: 'all', type: 'all' };
  if (filters.teacher && filters.teacher !== 'all') {
    displayClasses = displayClasses.filter(c => c.teacherName === filters.teacher);
  }
  if (filters.country && filters.country !== 'all') {
    displayClasses = displayClasses.filter(c => c.country === filters.country);
  }
  if (filters.status && filters.status !== 'all') {
    displayClasses = displayClasses.filter(c => c.status === filters.status);
  }
  if (filters.type && filters.type !== 'all') {
    displayClasses = displayClasses.filter(c => c.type === filters.type);
  }

  // Active filter badge count
  let activeFilterCount = 0;
  if (filters.teacher !== 'all') activeFilterCount++;
  if (filters.country !== 'all') activeFilterCount++;
  if (filters.status !== 'all') activeFilterCount++;
  if (filters.type !== 'all') activeFilterCount++;
  const isAnyFilterActive = activeFilterCount > 0;

  // Options for filter selects
  const uniqueTeachers = Array.from(new Set(allClasses.map(c => c.teacherName).filter(Boolean))).sort();
  const uniqueCountries = Array.from(new Set(allClasses.map(c => c.country).filter(Boolean))).sort();

  const teacherOptions = uniqueTeachers.map(t =>
    `<option value="${t}" ${filters.teacher === t ? 'selected' : ''}>${t}</option>`
  ).join('');

  const countryOptions = uniqueCountries.map(co =>
    `<option value="${co}" ${filters.country === co ? 'selected' : ''}>${co}</option>`
  ).join('');

  return `
    <!-- Card Header -->
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
      <div>
        <div class="flex items-center gap-2.5">
          <h3 class="text-base font-bold text-[#141F1E]">Live Class Monitoring</h3>
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#E8EFEE] text-[#0E4D45] border border-[#0E4D45]/20 tabular-nums">
            ${headerPillText}
          </span>
        </div>
        <p class="text-xs text-[#7A8684] mt-0.5">${formatLiveClassHeaderDate(targetDate)}</p>
      </div>

      <!-- Header Controls: Show All Toggle, Generate, + Add Class -->
      <div class="flex items-center gap-2 shrink-0 flex-wrap">
        <button type="button"
          onclick="toggleLiveClassShowAllToday()"
          class="px-3 py-1.5 rounded-lg text-xs font-semibold ${AppState.liveClassShowAllToday ? 'bg-[#0E4D45] text-white border border-[#0E4D45]' : 'bg-white text-[#7A8684] hover:text-[#141F1E] border border-[#ECEAE4] hover:border-[#CBD5E1]'} transition-all cursor-pointer">
          ${AppState.liveClassShowAllToday ? 'Showing All Classes' : "Show All Today's Classes"}
        </button>

        <button type="button"
          onclick="generateTodayLiveClasses()"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-[#ECEAE4] text-[#141F1E] hover:bg-[#F8F6F1] hover:border-[#CBD5E1] transition-all cursor-pointer">
          <svg class="w-3.5 h-3.5 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
          <span>Generate</span>
        </button>

        <button type="button"
          onclick="openAddLiveClassModal()"
          class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#0E4D45] hover:bg-[#14534B] text-white transition-all shadow-xs cursor-pointer">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          <span>+ Add Class</span>
        </button>
      </div>
    </div>

    <!-- Compact Live Operational Strip -->
    <div class="bg-[#F8F6F1] border border-[#ECEAE4] rounded-xl p-3 mb-5">
      ${totalClassesCount === 0 ? `
        <div class="text-xs text-[#7A8684] text-center py-0.5 font-medium">
          No classes scheduled yet
        </div>
      ` : `
      <div class="grid grid-cols-2 sm:grid-cols-3 md:flex md:items-center md:justify-between gap-3 text-xs">
        <div class="flex items-center gap-2">
          <span class="text-[#7A8684] text-[11px] font-medium">Classes:</span>
          <span class="font-bold text-[#141F1E] tabular-nums text-sm">${totalClassesCount}</span>
        </div>
        <div class="hidden md:block w-px h-5 bg-[#ECEAE4]"></div>

        <div class="flex items-center gap-2">
          <span class="text-[#7A8684] text-[11px] font-medium">Hours Taught:</span>
          <span class="font-bold text-[#141F1E] tabular-nums text-sm">${hoursTaughtStr}</span>
        </div>
        <div class="hidden md:block w-px h-5 bg-[#ECEAE4]"></div>

        <div class="flex items-center gap-2">
          <span class="text-[#7A8684] text-[11px] font-medium">Taken Rate:</span>
          <span class="font-bold ${takenCount > 0 ? 'text-[#0E4D45]' : 'text-[#141F1E]'} tabular-nums text-sm">${takenRateStr}</span>
        </div>
        <div class="hidden md:block w-px h-5 bg-[#ECEAE4]"></div>

        <div class="flex items-center gap-2">
          <span class="text-[#7A8684] text-[11px] font-medium">Absent:</span>
          <span class="font-bold ${absentCount > 0 ? 'text-[#B91C1C]' : 'text-[#141F1E]'} tabular-nums text-sm">${absentCount}</span>
        </div>
        <div class="hidden md:block w-px h-5 bg-[#ECEAE4]"></div>

        <div class="flex items-center gap-2">
          <span class="text-[#7A8684] text-[11px] font-medium">Teachers on Duty:</span>
          <span class="font-bold text-[#141F1E] tabular-nums text-sm">${teachersOnDutyStr}</span>
        </div>
      </div>
      `}
    </div>

    <!-- Minimalist Filter Toolbar (Stripe-Style — No Clutter) -->
    <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4 relative">
      <!-- Search Input -->
      <div class="relative flex-1">
        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#7A8684]">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>
        </div>
        <input type="text"
          placeholder="Search student or teacher..."
          value="${AppState.liveClassSearch || ''}"
          oninput="handleLiveClassSearch(this.value)"
          class="w-full pl-9 pr-3 py-2 bg-white border border-[#ECEAE4] rounded-xl text-xs text-[#141F1E] placeholder-[#7A8684] outline-none focus:border-[#0E4D45] transition-colors"
        />
      </div>

      <!-- Controls: Date Picker + Single Filter Button -->
      <div class="flex items-center gap-2 shrink-0">
        <!-- Date Picker -->
        <div>
          <input type="date"
            value="${targetDate}"
            onchange="handleLiveClassDateChange(this.value)"
            class="bg-white border border-[#ECEAE4] rounded-xl px-3 py-2 text-xs font-medium text-[#141F1E] outline-none focus:border-[#0E4D45] cursor-pointer"
          />
        </div>

        <!-- Single Filter Popover Trigger -->
        <div class="relative" id="live-class-filter-container">
          <button type="button"
            onclick="toggleLiveClassFilterPopover(event)"
            class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold ${isAnyFilterActive ? 'bg-[#E8EFEE] text-[#0E4D45] border border-[#0E4D45]/30' : 'bg-white text-[#7A8684] border border-[#ECEAE4] hover:text-[#141F1E] hover:border-[#CBD5E1]'} transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"/></svg>
            <span>Filter</span>
            ${activeFilterCount > 0 ? `<span class="w-4 h-4 rounded-full bg-[#0E4D45] text-white text-[10px] flex items-center justify-center font-bold">${activeFilterCount}</span>` : ''}
          </button>

          <!-- Filter Popover -->
          <div id="live-class-filter-popover" class="${AppState.liveClassFilterOpen ? '' : 'hidden'} absolute right-0 top-full mt-2 w-72 sm:w-80 bg-white border border-[#ECEAE4] rounded-2xl shadow-xl p-4 z-30">
            <div class="flex items-center justify-between pb-3 border-b border-[#ECEAE4] mb-3">
              <span class="text-xs font-bold text-[#141F1E]">Filter Live Classes</span>
              ${isAnyFilterActive ? `<button type="button" onclick="resetLiveClassFilters(event)" class="text-[11px] font-semibold text-[#0E4D45] hover:underline cursor-pointer">Reset all</button>` : ''}
            </div>

            <div class="space-y-3 text-xs">
              <div>
                <label class="block text-[11px] font-semibold text-[#7A8684] mb-1">Teacher</label>
                <select onchange="applyLiveClassFilter('teacher', this.value)" class="w-full bg-white border border-[#ECEAE4] rounded-lg px-2.5 py-1.5 text-xs text-[#141F1E] outline-none focus:border-[#0E4D45] cursor-pointer">
                  <option value="all" ${filters.teacher === 'all' ? 'selected' : ''}>All Teachers</option>
                  ${teacherOptions}
                </select>
              </div>

              <div>
                <label class="block text-[11px] font-semibold text-[#7A8684] mb-1">Country</label>
                <select onchange="applyLiveClassFilter('country', this.value)" class="w-full bg-white border border-[#ECEAE4] rounded-lg px-2.5 py-1.5 text-xs text-[#141F1E] outline-none focus:border-[#0E4D45] cursor-pointer">
                  <option value="all" ${filters.country === 'all' ? 'selected' : ''}>All Countries</option>
                  ${countryOptions}
                </select>
              </div>

              <div>
                <label class="block text-[11px] font-semibold text-[#7A8684] mb-1">Activity Status</label>
                <select onchange="applyLiveClassFilter('status', this.value)" class="w-full bg-white border border-[#ECEAE4] rounded-lg px-2.5 py-1.5 text-xs text-[#141F1E] outline-none focus:border-[#0E4D45] cursor-pointer">
                  <option value="all" ${filters.status === 'all' ? 'selected' : ''}>All Statuses</option>
                  <option value="Taken" ${filters.status === 'Taken' ? 'selected' : ''}>Taken</option>
                  <option value="Still to go" ${filters.status === 'Still to go' ? 'selected' : ''}>Still to go</option>
                  <option value="Absent" ${filters.status === 'Absent' ? 'selected' : ''}>Absent</option>
                  <option value="Overdue" ${filters.status === 'Overdue' ? 'selected' : ''}>Overdue</option>
                  <option value="Leave" ${filters.status === 'Leave' ? 'selected' : ''}>Leave</option>
                  <option value="Cancelled" ${filters.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
                </select>
              </div>

              <div>
                <label class="block text-[11px] font-semibold text-[#7A8684] mb-1">Class Type</label>
                <select onchange="applyLiveClassFilter('type', this.value)" class="w-full bg-white border border-[#ECEAE4] rounded-lg px-2.5 py-1.5 text-xs text-[#141F1E] outline-none focus:border-[#0E4D45] cursor-pointer">
                  <option value="all" ${filters.type === 'all' ? 'selected' : ''}>All Types</option>
                  <option value="Regular" ${filters.type === 'Regular' ? 'selected' : ''}>Regular</option>
                  <option value="Trial" ${filters.type === 'Trial' ? 'selected' : ''}>Trial</option>
                  <option value="Make-up" ${filters.type === 'Make-up' ? 'selected' : ''}>Make-up / Revision</option>
                </select>
              </div>
            </div>

            <div class="mt-4 pt-3 border-t border-[#ECEAE4] flex items-center justify-end">
              <button type="button" onclick="closeLiveClassFilterPopover(event)" class="px-3.5 py-1.5 rounded-lg bg-[#0E4D45] hover:bg-[#14534B] text-white text-xs font-semibold cursor-pointer">Done</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State or Data Content -->
    ${displayClasses.length === 0 ? `
      <div class="text-center py-12 px-4 bg-[#F8F6F1]/40 rounded-2xl border border-dashed border-[#ECEAE4]">
        <div class="max-w-xs mx-auto flex flex-col items-center">
          <div class="w-10 h-10 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mb-2.5">
            <svg class="w-5 h-5 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
          </div>
          <p class="text-xs font-semibold text-[#141F1E]">No classes scheduled for this window</p>
          <p class="text-[11px] text-[#7A8684] mt-1 mb-4">Click Generate to load from today's schedule, or toggle Show All Today's Classes.</p>
          <button type="button" onclick="generateTodayLiveClasses()" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-[#0E4D45] hover:bg-[#14534B] text-white shadow-xs cursor-pointer transition-colors">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
            <span>Generate Today's Classes</span>
          </button>
        </div>
      </div>
    ` : `
      <!-- Desktop Multi-Timezone Table (min-width: 769px) -->
      <div class="hidden md:block overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="border-b border-[#ECEAE4] text-[11px] font-semibold text-[#7A8684]">
              <th class="pb-3 w-10">#</th>
              <th class="pb-3">A-Time (PKT)</th>
              <th class="pb-3">T-Time</th>
              <th class="pb-3">S-Time</th>
              <th class="pb-3">Student</th>
              <th class="pb-3">Teacher</th>
              <th class="pb-3">Status</th>
              <th class="pb-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#ECEAE4] text-xs">
            ${displayClasses.map((cls, idx) => {
              const times = formatMultiTimezoneTimes(cls.scheduledTime, cls.studentTimezone, cls.teacherTimezone);
              const badge = getLiveClassStatusBadge(cls.status);
              return `
                <tr class="hover:bg-[#F8F6F1]/60 transition-colors">
                  <td class="py-3 text-[#7A8684] tabular-nums font-mono text-[11px]">${idx + 1}</td>
                  <td class="py-3 font-bold text-[#0E4D45] whitespace-nowrap tabular-nums">
                    <span>${times.aTime}</span>
                  </td>
                  <td class="py-3 text-[#141F1E] font-medium whitespace-nowrap tabular-nums">${times.tTime}</td>
                  <td class="py-3 text-[#7A8684] whitespace-nowrap tabular-nums">${times.sTime}</td>
                  <td class="py-3">
                    <div class="flex items-center gap-2">
                      <img src="${cls.studentAvatar}" alt="${cls.studentName}" class="w-6 h-6 rounded-full object-cover shrink-0 border border-[#ECEAE4]" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(cls.studentName)}&background=0E4D45&color=fff'">
                      <div class="min-w-0">
                        <span class="font-medium text-[#141F1E] block truncate">${cls.studentName}</span>
                        <span class="text-[10px] text-[#7A8684] block">${cls.country || 'Global'} · ${cls.type} (${cls.duration})</span>
                      </div>
                    </div>
                  </td>
                  <td class="py-3 text-[#141F1E] font-medium whitespace-nowrap">${cls.teacherName}</td>
                  <td class="py-3 whitespace-nowrap">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${badge.class}">${badge.label}</span>
                  </td>
                  <td class="py-3 text-right whitespace-nowrap">
                    <div class="flex items-center justify-end gap-1.5">
                      <select onchange="markLiveClassStatus('${cls.id}', this.value)" class="text-[11px] font-semibold bg-[#F8F6F1] hover:bg-[#E8EFEE] text-[#0E4D45] border border-[#ECEAE4] rounded-lg px-2 py-1 outline-none cursor-pointer transition-colors">
                        <option value="" disabled selected>Update</option>
                        <option value="Taken">Taken</option>
                        <option value="Absent">Absent</option>
                        <option value="Still to go">Still to go</option>
                        <option value="Leave">Leave</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                      <button type="button" onclick="dbDeleteLiveClass('${cls.id}')" title="Delete session" class="w-7 h-7 rounded-lg border border-[#ECEAE4] text-[#7A8684] hover:text-[#B91C1C] hover:bg-[#FEE2E2]/30 flex items-center justify-center transition-colors cursor-pointer">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- Mobile Stacked Cards (max-width: 768px, zero horizontal scrolling) -->
      <div class="block md:hidden space-y-3">
        ${displayClasses.map((cls) => {
          const times = formatMultiTimezoneTimes(cls.scheduledTime, cls.studentTimezone, cls.teacherTimezone);
          const badge = getLiveClassStatusBadge(cls.status);
          return `
            <div class="bg-white border border-[#ECEAE4] rounded-2xl p-4 shadow-2xs space-y-3">
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2.5 min-w-0">
                  <img src="${cls.studentAvatar}" alt="${cls.studentName}" class="w-9 h-9 rounded-full object-cover shrink-0 border border-[#ECEAE4]" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(cls.studentName)}&background=0E4D45&color=fff'">
                  <div class="min-w-0">
                    <h4 class="text-xs font-bold text-[#141F1E] truncate">${cls.studentName}</h4>
                    <p class="text-[11px] text-[#7A8684] truncate">${cls.teacherName} · <span class="text-[#334E4B]">${cls.country || 'Global'}</span></p>
                  </div>
                </div>
                <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${badge.class} shrink-0">${badge.label}</span>
              </div>

              <!-- 3-Column Time Grid -->
              <div class="grid grid-cols-3 gap-1 bg-[#F8F6F1] rounded-xl p-2.5 text-center border border-[#ECEAE4]">
                <div class="px-1">
                  <span class="block text-[9px] font-bold text-[#7A8684] uppercase tracking-wider">A-Time</span>
                  <span class="text-xs font-bold text-[#0E4D45] tabular-nums block truncate">${times.aTime}</span>
                </div>
                <div class="px-1 border-x border-[#ECEAE4]">
                  <span class="block text-[9px] font-bold text-[#7A8684] uppercase tracking-wider">T-Time</span>
                  <span class="text-xs font-semibold text-[#141F1E] tabular-nums block truncate">${times.tTime}</span>
                </div>
                <div class="px-1">
                  <span class="block text-[9px] font-bold text-[#7A8684] uppercase tracking-wider">S-Time</span>
                  <span class="text-xs font-semibold text-[#141F1E] tabular-nums block truncate">${times.sTime}</span>
                </div>
              </div>

              <!-- Card Footer: Type & Actions -->
              <div class="flex items-center justify-between pt-1">
                <span class="text-[10px] font-medium px-2 py-0.5 rounded bg-[#F8F6F1] border border-[#ECEAE4] text-[#7A8684]">${cls.type} (${cls.duration})</span>
                <div class="flex items-center gap-2">
                  <select onchange="markLiveClassStatus('${cls.id}', this.value)" class="text-xs font-semibold bg-[#F8F6F1] text-[#0E4D45] border border-[#ECEAE4] rounded-lg px-2 py-1 outline-none cursor-pointer">
                    <option value="" disabled selected>Update</option>
                    <option value="Taken">Taken</option>
                    <option value="Absent">Absent</option>
                    <option value="Still to go">Still to go</option>
                    <option value="Leave">Leave</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                  <button type="button" onclick="dbDeleteLiveClass('${cls.id}')" title="Delete" class="w-7 h-7 rounded-lg border border-[#ECEAE4] text-[#7A8684] hover:text-[#B91C1C] hover:bg-[#FEE2E2]/30 flex items-center justify-center transition-colors cursor-pointer">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}
window.renderLiveClassMonitoringMarkup = renderLiveClassMonitoringMarkup;

// ============================================================
// AT-RISK STUDENTS ENGINE (ACTION REQUIRED)
// Analyzes student body for critical flags:
// 1. Fee Defaulters (Unpaid 1-3+ Months / Overdue)
// 2. Attendance flags (Absent 3+ Days, Attendance < 75%)
// 3. Academic Stalls (Failing Progress < 50%, Needs Revision)
// 4. Status Flags ('Defaulter', 'At Risk', 'Probation')
// ============================================================

function getAtRiskStudents(customStudents) {
  const students = customStudents || (AppState.students && AppState.students.length > 0 ? AppState.students : loadFromStorage('lms_students', []));
  if (!Array.isArray(students) || students.length === 0) return [];

  const atRiskList = [];

  students.forEach(student => {
    if (!student) return;

    // 1. Fee Defaulter / Overdue Risk Analysis
    let feeIssue = null;
    let overdueMonthsCount = 0;
    let overdueTotalAmount = 0;

    if (Array.isArray(student.months) && student.months.length > 0) {
      const maxMonth = Math.min((typeof CURRENT_MONTH_INDEX !== 'undefined' ? CURRENT_MONTH_INDEX : 9), student.months.length - 1);
      for (let i = 0; i <= maxMonth; i++) {
        const m = student.months[i];
        if (m) {
          const isOverdue = m.status === 'defaulter' || m.feeStatus === 'Overdue' || m.feeStatus === 'Unpaid' || m.feeStatus === 'Defaulter';
          const isPartial = m.status === 'partial' || m.feeStatus === 'Partial';
          if (isOverdue) {
            overdueMonthsCount++;
            const fee = Number(student.monthlyFee) || Number(m.amount) || 50;
            const paid = Number(m.paidAmount) || 0;
            overdueTotalAmount += Math.max(0, fee - paid);
          } else if (isPartial) {
            const fee = Number(student.monthlyFee) || Number(m.amount) || 50;
            const paid = Number(m.paidAmount) || 0;
            overdueTotalAmount += Math.max(0, fee - paid);
          }
        }
      }
    }

    const feeStatus = typeof getStudentFeeStatus === 'function' ? getStudentFeeStatus(student) : null;
    const isFeeDefaulter = (feeStatus && feeStatus.code === 'defaulter') || overdueMonthsCount > 0 || student.academicStatus === 'Defaulter';

    // Overdue total in PKR for the badge/description (fall back to $ only when no rate exists).
    const overduePKR = convertToPKR(overdueTotalAmount, student.currencyCode);
    const overduePKRText = overduePKR.hasRate ? formatPKRAmount(overduePKR.pkr) : ('$' + (overdueTotalAmount || (overdueMonthsCount * 50)));

    if (isFeeDefaulter) {
      if (overdueMonthsCount >= 2) {
        feeIssue = {
          badge: `Unpaid ${overdueMonthsCount} Months`,
          severity: 'critical',
          description: `Overdue tuition balance of ${overduePKRText} pending clearance`,
          priority: 1
        };
      } else {
        feeIssue = {
          badge: overdueTotalAmount > 0 ? (overduePKR.hasRate ? `Unpaid ${formatPKRAmount(overduePKR.pkr)}` : `Unpaid $${overdueTotalAmount}`) : 'Unpaid 1 Month',
          severity: 'critical',
          description: `Outstanding tuition payment overdue`,
          priority: 2
        };
      }
    } else if (feeStatus && feeStatus.code === 'partial') {
      feeIssue = {
        badge: 'Partial Due',
        severity: 'warning',
        description: `Remaining balance pending for current cycle`,
        priority: 4
      };
    }

    // 2. Attendance Risk Analysis (Absent 3+ Days, Low Attendance Rate)
    let attendanceIssue = null;
    const consecutiveAbsences = Number(student.consecutiveAbsences) || Number(student.absentDays) || 0;
    const attendanceRate = typeof student.attendanceRate === 'number' ? student.attendanceRate : null;

    if (consecutiveAbsences >= 3) {
      attendanceIssue = {
        badge: `Absent ${consecutiveAbsences}+ Days`,
        severity: 'critical',
        description: `Missed ${consecutiveAbsences} consecutive Quran lessons without leave notice`,
        priority: 1
      };
    } else if (attendanceRate !== null && attendanceRate > 0 && attendanceRate < 75) {
      attendanceIssue = {
        badge: `Low Attendance (${Math.round(attendanceRate)}%)`,
        severity: 'warning',
        description: `Lesson attendance has dropped below 75% academy threshold`,
        priority: 3
      };
    } else if (student.academicStatus === 'At Risk' || student.academicStatus === 'Probation') {
      attendanceIssue = {
        badge: `Absenteeism Alert`,
        severity: 'warning',
        description: `Flagged for repeated lesson absenteeism`,
        priority: 3
      };
    }

    // 3. Academic Progress Risk Analysis (Failing Progress / Low Sabaq Score)
    let progressIssue = null;
    let score = null;
    if (typeof student.progressScore === 'number' && student.progressScore > 0) score = student.progressScore;
    else if (typeof student.sabaqGrade === 'number' && student.sabaqGrade > 0) score = student.sabaqGrade;
    else if (student.lastSabaq) {
      if (typeof student.lastSabaq.progressScore === 'number' && student.lastSabaq.progressScore > 0) score = student.lastSabaq.progressScore;
      else if (typeof student.lastSabaq.sabaqGrade === 'number' && student.lastSabaq.sabaqGrade > 0) score = student.lastSabaq.sabaqGrade;
      else if (student.lastSabaq.rating && student.lastSabaq.type === 'Daily Sabaq') score = (student.lastSabaq.rating / 5) * 100;
    }

    if (score !== null && score > 0 && score < 50) {
      progressIssue = {
        badge: `Failing Progress (${Math.round(score)}%)`,
        severity: 'critical',
        description: `Sabaq score is below 50% passing threshold; needs revision`,
        priority: 2
      };
    } else if (score !== null && score >= 50 && score < 65) {
      progressIssue = {
        badge: `Needs Revision (${Math.round(score)}%)`,
        severity: 'warning',
        description: `Tajweed retention score indicates student is struggling`,
        priority: 4
      };
    }

    // 4. Custom Risk Badge override if provided on student
    let primaryIssue = null;
    if (student.riskBadge) {
      primaryIssue = {
        badge: student.riskBadge,
        severity: student.riskSeverity || 'critical',
        description: student.riskReason || 'Administrative attention required'
      };
    } else {
      // Pick highest priority issue (lower number = higher priority)
      const issues = [feeIssue, attendanceIssue, progressIssue].filter(Boolean);
      if (issues.length > 0) {
        issues.sort((a, b) => (a.priority || 5) - (b.priority || 5));
        primaryIssue = issues[0];
      }
    }

    if (primaryIssue) {
      atRiskList.push({
        student: student,
        badge: primaryIssue.badge,
        severity: primaryIssue.severity,
        description: primaryIssue.description
      });
    }
  });

  return atRiskList;
}

function renderAtRiskStudentsWidgetMarkup() {
  const atRiskList = getAtRiskStudents();
  const alertCount = atRiskList.length;

  return `
    <!-- Widget Header: Title with Subtle Red Warning & Subtitle -->
    <div class="flex items-center justify-between gap-4 mb-3">
      <div class="flex items-center gap-2.5">
        <!-- Red Warning Icon in Soft Red Container -->
        <div class="w-8 h-8 rounded-xl bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA] flex items-center justify-center shrink-0">
          <svg class="w-4 h-4 text-[#DC2626]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/>
          </svg>
        </div>
        <div>
          <h3 class="text-base font-bold text-[#141F1E] tracking-tight">At-Risk Students</h3>
          <p class="text-xs text-[#7A8684]">Students requiring immediate admin attention</p>
        </div>
      </div>

      <!-- Header Counter Badge -->
      <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold ${
        alertCount > 0 
          ? 'bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA]' 
          : 'bg-[#E0F2F1] text-[#0E4D45] border border-[#B2DFDB]/60'
      }">
        ${alertCount > 0 ? `
          <span class="w-1.5 h-1.5 rounded-full bg-[#EF4444]"></span>
          <span>${alertCount} Action Required</span>
        ` : `
          <span>0 Alerts</span>
        `}
      </span>
    </div>

    <!-- Subheader Note / Counter -->
    <div class="flex items-center justify-between text-xs text-[#7A8684] mb-3 pb-2 border-b border-[#ECEAE4]">
      <span>Status Priority: Fee Defaulters, Absences, Failing Progress</span>
      <span class="font-medium">${alertCount} ${alertCount === 1 ? 'student flagged' : 'students flagged'}</span>
    </div>

    <!-- Body: List of At-Risk Students or Positive Empty State -->
    ${alertCount === 0 ? `
      <div class="py-12 px-4 text-center rounded-2xl bg-[#F8F6F1]/50 border border-dashed border-[#ECEAE4] flex flex-col items-center justify-center my-2">
        <div class="w-12 h-12 rounded-full bg-[#E0F2F1] text-[#0E4D45] flex items-center justify-center mb-3 shadow-2xs">
          <svg class="w-6 h-6 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/>
          </svg>
        </div>
        <p class="text-sm font-semibold text-[#141F1E]">All students are performing well. No critical alerts.</p>
        <p class="text-xs text-[#7A8684] mt-1 max-w-sm">Zero attendance flags, failing progress scores, or overdue fee balances detected across the academy.</p>
      </div>
    ` : `
      <div class="space-y-2.5 max-h-[295px] overflow-y-auto pr-1">
        ${atRiskList.map(item => {
          const s = item.student;
          const studentName = s.firstName ? `${s.firstName} ${s.lastName || ''}`.trim() : (s.name || 'Student');
          const courseName = s.course || 'Quran Track';
          const avatarUrl = s.avatar || s.photo;
          const badge = item.badge;
          const isCritical = item.severity === 'critical';
          const badgeClass = isCritical 
            ? 'bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA]' 
            : 'bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]';

          return `
            <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl bg-[#F8F6F1]/60 hover:bg-[#F8F6F1] border border-[#ECEAE4] transition-all">
              <!-- Student Info: Avatar, Name & Track -->
              <div class="flex items-center gap-3 min-w-0">
                ${avatarUrl ? `
                  <img src="${avatarUrl}" alt="${studentName}" class="w-9 h-9 rounded-full object-cover border border-[#ECEAE4] shrink-0" onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(studentName)}&background=0E4D45&color=fff';">
                ` : `
                  <div class="w-9 h-9 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center font-semibold text-xs shrink-0 border border-[#ECEAE4]">
                    ${studentName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                `}
                <div class="min-w-0">
                  <h4 class="text-xs sm:text-sm font-semibold text-[#141F1E] truncate">${studentName}</h4>
                  <p class="text-[11px] text-[#7A8684] truncate">${courseName}</p>
                </div>
              </div>

              <!-- Right Side: Warning Badge & Action Button -->
              <div class="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
                <!-- Warning Badge -->
                <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${badgeClass} whitespace-nowrap shadow-2xs" title="${item.description}">
                  ${badge}
                </span>

                <!-- Minimalist Ghost Action Button: Contact Guardian -->
                <button type="button" onclick="contactStudentGuardian('${s.id}', event)" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#ECEAE4] bg-white hover:bg-[#F8F6F1] hover:border-[#CBD5E1] text-[#141F1E] text-xs font-medium transition-all shadow-2xs cursor-pointer" title="Contact Guardian on WhatsApp (${s.guardianName || 'Guardian'})">
                  <svg class="w-3.5 h-3.5 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                  </svg>
                  <span class="hidden sm:inline">Contact Guardian</span>
                  <span class="sm:hidden">Contact</span>
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}

function contactStudentGuardian(studentId, event) {
  if (event) event.stopPropagation();
  const students = (AppState.students && AppState.students.length > 0) ? AppState.students : loadFromStorage('lms_students', []);
  const student = students.find(s => s.id === studentId);
  if (!student) {
    showToastNotification('Student record not found.');
    return;
  }

  const studentName = student.firstName ? `${student.firstName} ${student.lastName || ''}`.trim() : (student.name || 'Student');
  const parentName = student.guardianName || 'Guardian';
  const phone = (student.whatsapp || student.phone || '').trim();
  const cleanPhone = phone.replace(/[^0-9]/g, '');

  const atRiskList = getAtRiskStudents([student]);
  const alertReason = atRiskList.length > 0 ? atRiskList[0].badge : 'attendance and progress';

  if (cleanPhone) {
    const message = `Assalam-o-Alaikum ${parentName},\n\nThis is an administrative update from Quranic Skills Academy regarding ${studentName} (${student.id}).\n\nNotice: ${alertReason}.\nWe kindly request a brief conversation to discuss recent updates and support their studies.\n\nJazakAllah Khair,\nAdmin Office - Quranic Skills Academy`;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    showToastNotification(`✓ Opening WhatsApp for ${parentName} (${studentName})`);
  } else {
    showToastNotification(`Alert: ${studentName} has no phone on file. Guardian: ${parentName}`);
  }
}

// ============================================================
// DUAL-METRIC ATTENDANCE VS PASS CHART ENGINE (Chart.js Native)
// Dynamic Firebase Firestore Integration & Professional Timeframe Selector
// - Timeframes: "This Week" (Daily), "This Month" (Daily), "This Year" (Monthly)
// - Real-time metrics computed directly from Firebase students & attendance_logs
// - Background Bars: Soft grey (#E5E7EB) -> Deep Teal (#0E4D45) on hover
// - Foreground Line: Smooth curved cubic bezier (#0E4D45, tension: 0.4)
// - Tooltip: Floating dark teal card with "Attend: X" and "Passed: Y"
// ============================================================

const ATTENDANCE_TIMEFRAMES = [
  { id: 'week', label: 'This Week', sub: 'Daily (Mon-Sun)' },
  { id: 'month', label: 'This Month', sub: 'Daily (1st-31st)' },
  { id: 'year', label: 'This Year', sub: 'Monthly (Jan-Dec)' }
];

function getDayWithOrdinal(d) {
  if (d > 3 && d < 21) return d + 'th';
  switch (d % 10) {
    case 1: return d + 'st';
    case 2: return d + 'nd';
    case 3: return d + 'rd';
    default: return d + 'th';
  }
}

/**
 * Dynamic calculation engine querying live Firebase Firestore data
 * Stripped of all fake/synthesized data: counts ONLY actual logged classes from Firestore
 */
function getAttendanceVsPassData(targetTimeframe) {
  const timeframe = targetTimeframe || AppState.attendanceTimeframe || 'month';
  const students = (AppState.students && Array.isArray(AppState.students)) ? AppState.students : [];
  const logs = (AppState.attendanceLogs && Array.isArray(AppState.attendanceLogs)) ? AppState.attendanceLogs : [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed: 0=Jan, 10=Nov
  const todayStr = now.toISOString().split('T')[0];

  let records = [];

  // ========================================================
  // 1. TIMEFRAME: THIS WEEK (Daily data points: Mon - Sun)
  // ========================================================
  if (timeframe === 'week') {
    const currentDayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const distToMonday = (currentDayOfWeek === 0 ? -6 : 1) - currentDayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + distToMonday);
    monday.setHours(0, 0, 0, 0);

    const weekDayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(monday);
      dayDate.setDate(monday.getDate() + i);
      const dayStr = dayDate.toISOString().split('T')[0];

      let attend = 0;
      let passed = 0;
      const accountedStudentIds = new Set();

      // Check live attendance logs recorded in Firebase Firestore
      logs.forEach(log => {
        if (log.date === dayStr) {
          accountedStudentIds.add(log.studentId);
          if (log.status === 'Present' || log.status === 'Late' || log.status === 'Attended') {
            attend++;
            if (log.passed || (typeof log.rating === 'number' && log.rating >= 3)) {
              passed++;
            }
          }
        }
      });

      // Check any recorded sabaqs/attendance on student docs in Firebase
      students.forEach(st => {
        if (accountedStudentIds.has(st.id)) return;

        // Check student's last recorded sabaq
        if (st.lastSabaq && st.lastSabaq.date === dayStr) {
          if (st.lastSabaq.status === 'Present' || st.lastSabaq.status === 'Late' || st.lastSabaq.status === 'Attended') {
            attend++;
            if (st.lastSabaq.rating >= 3) passed++;
            accountedStudentIds.add(st.id);
          }
        }

        // Check student's sabaq history entries
        if (Array.isArray(st.sabaqHistory)) {
          st.sabaqHistory.forEach(entry => {
            if (entry.date === dayStr && !accountedStudentIds.has(st.id)) {
              if (entry.status === 'Present' || entry.status === 'Late' || entry.status === 'Attended') {
                attend++;
                if (entry.rating >= 3 || entry.passed) passed++;
                accountedStudentIds.add(st.id);
              }
            }
          });
        }
      });

      records.push({
        label: weekDayNames[i],
        fullDate: dayStr,
        attend: attend,
        passed: passed
      });
    }
  }

  // ========================================================
  // 2. TIMEFRAME: THIS MONTH (Daily data points: 1st - 31st)
  // ========================================================
  else if (timeframe === 'month') {
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
      const dayDate = new Date(currentYear, currentMonth, d);
      const dayStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      let attend = 0;
      let passed = 0;
      const accountedStudentIds = new Set();

      // Check live attendance logs recorded in Firebase Firestore
      logs.forEach(log => {
        if (log.date === dayStr) {
          accountedStudentIds.add(log.studentId);
          if (log.status === 'Present' || log.status === 'Late' || log.status === 'Attended') {
            attend++;
            if (log.passed || (typeof log.rating === 'number' && log.rating >= 3)) {
              passed++;
            }
          }
        }
      });

      // Check any recorded sabaqs/attendance on student docs in Firebase
      students.forEach(st => {
        if (accountedStudentIds.has(st.id)) return;

        if (st.lastSabaq && st.lastSabaq.date === dayStr) {
          if (st.lastSabaq.status === 'Present' || st.lastSabaq.status === 'Late' || st.lastSabaq.status === 'Attended') {
            attend++;
            if (st.lastSabaq.rating >= 3) passed++;
            accountedStudentIds.add(st.id);
          }
        }

        if (Array.isArray(st.sabaqHistory)) {
          st.sabaqHistory.forEach(entry => {
            if (entry.date === dayStr && !accountedStudentIds.has(st.id)) {
              if (entry.status === 'Present' || entry.status === 'Late' || entry.status === 'Attended') {
                attend++;
                if (entry.rating >= 3 || entry.passed) passed++;
                accountedStudentIds.add(st.id);
              }
            }
          });
        }
      });

      records.push({
        label: getDayWithOrdinal(d),
        dayNum: d,
        fullDate: dayStr,
        attend: attend,
        passed: passed
      });
    }
  }

  // ========================================================
  // 3. TIMEFRAME: THIS YEAR (Monthly data points: Jan - Dec)
  // ========================================================
  else {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    monthNames.forEach((m, mIdx) => {
      let attend = 0;
      let passed = 0;

      // Add actual logged sessions recorded in Firebase Firestore for this month
      logs.forEach(log => {
        if (log.date) {
          const parts = log.date.split('-');
          const logYear = parseInt(parts[0], 10);
          const logMonth = parseInt(parts[1], 10) - 1;
          if (logYear === currentYear && logMonth === mIdx) {
            if (log.status === 'Present' || log.status === 'Late' || log.status === 'Attended') {
              attend++;
              if (log.passed || (typeof log.rating === 'number' && log.rating >= 3)) {
                passed++;
              }
            }
          }
        }
      });

      // Add actual logged sabaq entries recorded on student docs for this month
      students.forEach(st => {
        if (st.lastSabaq && st.lastSabaq.date) {
          const parts = st.lastSabaq.date.split('-');
          const sYear = parseInt(parts[0], 10);
          const sMonth = parseInt(parts[1], 10) - 1;
          if (sYear === currentYear && sMonth === mIdx) {
            // Check if not already logged in logs
            const alreadyInLogs = logs.some(l => l.studentId === st.id && l.date === st.lastSabaq.date);
            if (!alreadyInLogs) {
              if (st.lastSabaq.status === 'Present' || st.lastSabaq.status === 'Late' || st.lastSabaq.status === 'Attended') {
                attend++;
                if (st.lastSabaq.rating >= 3) passed++;
              }
            }
          }
        }

        if (Array.isArray(st.sabaqHistory)) {
          st.sabaqHistory.forEach(entry => {
            if (entry.date) {
              const parts = entry.date.split('-');
              const sYear = parseInt(parts[0], 10);
              const sMonth = parseInt(parts[1], 10) - 1;
              if (sYear === currentYear && sMonth === mIdx) {
                const alreadyInLogs = logs.some(l => l.studentId === st.id && l.date === entry.date);
                if (!alreadyInLogs) {
                  if (entry.status === 'Present' || entry.status === 'Late' || entry.status === 'Attended') {
                    attend++;
                    if (entry.rating >= 3 || entry.passed) passed++;
                  }
                }
              }
            }
          });
        }
      });

      records.push({
        label: m,
        monthIndex: mIdx,
        attend: attend,
        passed: passed
      });
    });
  }

  // Calculate overall aggregates
  const totalAttend = records.reduce((sum, r) => sum + r.attend, 0);
  const totalPassed = records.reduce((sum, r) => sum + r.passed, 0);
  const avgPassingRate = totalAttend > 0 ? Math.round((totalPassed / totalAttend) * 100) : 0;
  const hasData = totalAttend > 0;

  // If no live data has been logged in Firestore, return empty dataset arrays by default
  if (!hasData) {
    return {
      timeframe: timeframe,
      hasData: false,
      records: [],
      labels: [],
      attendData: [],
      passedData: [],
      avgPassingRate: 0,
      totalAttend: 0,
      totalPassed: 0
    };
  }

  return {
    timeframe: timeframe,
    hasData: true,
    records: records,
    labels: records.map(r => r.label),
    attendData: records.map(r => r.attend),
    passedData: records.map(r => r.passed),
    avgPassingRate: avgPassingRate,
    totalAttend: totalAttend,
    totalPassed: totalPassed
  };
}

function renderAttendanceChartTooltip(context) {
  const { chart, tooltip } = context;
  const tooltipEl = document.getElementById('attendance-chart-tooltip');
  if (!tooltipEl) return;

  if (tooltip.opacity === 0) {
    tooltipEl.style.opacity = '0';
    tooltipEl.classList.add('hidden');
    return;
  }

  if (tooltip.body) {
    const titleLines = tooltip.title || [];
    const title = titleLines.join(' ');

    const dataPoints = tooltip.dataPoints || [];
    let attendVal = 0;
    let passedVal = 0;

    dataPoints.forEach(dp => {
      if (dp.datasetIndex === 0) attendVal = dp.raw;
      else if (dp.datasetIndex === 1) passedVal = dp.raw;
    });

    tooltipEl.innerHTML = `
      <div class="px-3.5 py-2.5 bg-[#0E4D45] text-white rounded-xl shadow-2xl border border-[#14534B]/80 min-w-[130px] pointer-events-none select-none">
        <div class="text-[11px] font-semibold text-[#A3C2BE] mb-1.5 pb-1 border-b border-white/10">${title}</div>
        <div class="flex items-center justify-between gap-4 text-xs py-0.5">
          <span class="text-[#D1D5DB] font-medium flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-[#D1D5DB] inline-block"></span> Attend:
          </span>
          <span class="font-bold text-white font-mono">${attendVal}</span>
        </div>
        <div class="flex items-center justify-between gap-4 text-xs py-0.5">
          <span class="text-[#A3C2BE] font-medium flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-[#34D399] inline-block"></span> Passed:
          </span>
          <span class="font-bold text-emerald-300 font-mono">${passedVal}</span>
        </div>
      </div>
    `;
  }

  const { offsetLeft: positionX, offsetTop: positionY } = chart.canvas;
  const caretX = tooltip.caretX;
  const caretY = tooltip.caretY;
  const chartWidth = chart.width;

  // Horizontal bounds logic to keep tooltip within container
  let translateX = '-50%';
  if (caretX < 75) {
    translateX = '0%';
  } else if (caretX > chartWidth - 75) {
    translateX = '-100%';
  }

  // Vertical bounds logic: place above point by default, below if near top
  let translateY = '-100%';
  let offsetY = -10;
  if (caretY < 60) {
    translateY = '0%';
    offsetY = 14;
  }

  tooltipEl.style.transform = `translate(${translateX}, ${translateY})`;
  tooltipEl.style.left = (positionX + caretX) + 'px';
  tooltipEl.style.top = (positionY + caretY + offsetY) + 'px';
  tooltipEl.style.opacity = '1';
  tooltipEl.style.zIndex = '50';
  tooltipEl.classList.remove('hidden');
}

function renderAttendanceVsPassCardMarkup() {
  const currentTimeframe = AppState.attendanceTimeframe || 'month';
  const selectedTf = ATTENDANCE_TIMEFRAMES.find(t => t.id === currentTimeframe) || ATTENDANCE_TIMEFRAMES[1];
  const chartData = getAttendanceVsPassData(currentTimeframe);
  const hasData = chartData.hasData;
  const avgPassingRate = chartData.avgPassingRate;

  return `
    <!-- Card Header: Title & Professional Timeframe Selector -->
    <div class="flex items-center justify-between gap-4 mb-2">
      <h3 class="text-base sm:text-lg font-bold text-[#141F1E] tracking-tight">Total Attendance vs Total Pass</h3>
      
      <!-- Top Right Controls: Professional Timeframe Selector Dropdown -->
      <div class="relative" id="attendance-timeframe-dropdown-wrapper">
        <button type="button" onclick="toggleAttendanceTimeframeDropdown(event)" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#ECEAE4] bg-white text-xs font-semibold text-[#141F1E] hover:border-[#D1D5DB] transition-all shadow-2xs cursor-pointer">
          <svg class="w-3.5 h-3.5 text-[#7A8684]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/>
          </svg>
          <span id="attendance-selected-timeframe-label">${selectedTf.label}</span>
          <svg class="w-3 h-3 text-[#7A8684] transition-transform duration-200" id="attendance-timeframe-chevron" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>

        <div id="attendance-timeframe-dropdown-menu" class="hidden absolute right-0 mt-1.5 w-48 bg-white border border-[#ECEAE4] rounded-xl shadow-lg py-1.5 z-30 text-xs">
          ${ATTENDANCE_TIMEFRAMES.map(tf => {
            const isSelected = tf.id === currentTimeframe;
            return `
              <button type="button" onclick="selectAttendanceTimeframe('${tf.id}', event)" class="w-full text-left px-3.5 py-2 flex items-center justify-between transition-colors ${isSelected ? 'font-bold text-[#0E4D45] bg-[#E8EFEE]/60' : 'text-[#4B5563] hover:bg-[#F8F6F1] font-medium'}">
                <div class="flex flex-col">
                  <span class="text-xs ${isSelected ? 'font-bold text-[#0E4D45]' : 'text-[#141F1E]'}">${tf.label}</span>
                  <span class="text-[10px] text-[#7A8684]">${tf.sub}</span>
                </div>
                ${isSelected ? '<span class="text-[#0E4D45] font-bold text-sm">✓</span>' : ''}
              </button>
            `;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- Subheader: AVG Passing Rate & Custom Legend -->
    <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
      <div class="flex items-baseline gap-2">
        <span class="text-xs sm:text-sm font-medium text-[#7A8684]">AVG Passing Rate</span>
        <span class="text-xl sm:text-2xl font-semibold text-[#141F1E] tabular-nums" id="attendance-avg-pass-rate">${hasData ? avgPassingRate + '%' : '—'}</span>
        ${!hasData ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-[#F8F6F1] text-[#7A8684] border border-[#ECEAE4]">Pending</span>` : ''}
      </div>

      <!-- Custom Legend matching Reference Image -->
      <div class="flex items-center gap-4 text-xs font-medium text-[#7A8684]">
        <div class="flex items-center gap-1.5">
          <span class="w-3.5 h-3.5 rounded-full bg-[#D1D5DB] inline-block"></span>
          <span>Total Attendance</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-3.5 h-3.5 rounded-full border-2 border-[#0E4D45] bg-white inline-block"></span>
          <span class="text-[#141F1E] font-semibold">Passed</span>
        </div>
      </div>
    </div>

    <!-- Chart Body Container: Chart.js Canvas or Empty State -->
    ${!hasData ? `
      <div class="py-12 px-4 text-center rounded-2xl bg-[#F8F6F1]/50 border border-dashed border-[#ECEAE4] flex flex-col items-center justify-center my-2">
        <div class="w-12 h-12 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mb-3">
          <svg class="w-6 h-6 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/>
          </svg>
        </div>
        <p class="text-sm font-semibold text-[#141F1E]">No Attendance &amp; Pass Data Logged for ${selectedTf.label}</p>
        <p class="text-xs text-[#7A8684] mt-1 max-w-md mx-auto leading-relaxed">No live attendance records found for ${selectedTf.label.toLowerCase()}. Attendance records will appear here as classes are conducted.</p>
      </div>
    ` : `
      <div class="relative w-full h-[260px] select-none overflow-visible" id="attendance-chart-wrapper">
        <canvas id="attendance-vs-pass-canvas" class="relative z-10 w-full h-full block"></canvas>
        <!-- Floating Tooltip Container with z-index: 50 (Always over lines, points & bars) -->
        <div id="attendance-chart-tooltip" class="absolute z-50 pointer-events-none transition-all duration-100 ease-out opacity-0 hidden" style="z-index: 50;"></div>
      </div>
    `}
  `;
}

function initAttendanceVsPassChart() {
  const currentTimeframe = AppState.attendanceTimeframe || 'month';
  const canvas = document.getElementById('attendance-vs-pass-canvas');
  if (!canvas) return;

  if (window._attendanceChartInstance) {
    try {
      window._attendanceChartInstance.destroy();
    } catch(e) {}
    window._attendanceChartInstance = null;
  }

  const chartData = getAttendanceVsPassData(currentTimeframe);
  if (!chartData || !chartData.hasData || !chartData.records || chartData.records.length === 0) {
    return;
  }

  if (typeof Chart === 'undefined') {
    console.warn('Chart.js engine not yet initialized.');
    return;
  }

  const records = chartData.records;
  const labels = records.map(r => r.label);
  const attendData = records.map(r => r.attend);
  const passedData = records.map(r => r.passed);

  // Timeframe-specific bar thickness and point radius styling
  let barThickness = 20;
  let maxBarThickness = 22;
  let borderRadius = 16;
  let pointRadius = 4.5;
  let pointHoverRadius = 6.5;

  if (currentTimeframe === 'week') {
    barThickness = 24;
    maxBarThickness = 28;
    borderRadius = 14;
    pointRadius = 4.5;
    pointHoverRadius = 6.5;
  } else if (currentTimeframe === 'month') {
    barThickness = records.length > 25 ? 6 : 10;
    maxBarThickness = records.length > 25 ? 8 : 12;
    borderRadius = 4;
    pointRadius = 2.5;
    pointHoverRadius = 5;
  }

  const ctx = canvas.getContext('2d');
  window._attendanceChartInstance = new Chart(ctx, {
    data: {
      labels: labels,
      datasets: [
        {
          type: 'bar',
          label: 'Total Attendance',
          data: attendData,
          backgroundColor: '#E5E7EB',
          hoverBackgroundColor: '#0E4D45',
          borderRadius: borderRadius,
          borderSkipped: false,
          barThickness: barThickness,
          maxBarThickness: maxBarThickness,
          order: 2
        },
        {
          type: 'line',
          label: 'Passed',
          data: passedData,
          borderColor: '#0E4D45',
          borderWidth: 2.75,
          tension: 0.4,
          fill: false,
          pointBackgroundColor: '#FFFFFF',
          pointBorderColor: '#0E4D45',
          pointBorderWidth: 2.5,
          pointRadius: pointRadius,
          pointHoverRadius: pointHoverRadius,
          pointHoverBorderWidth: 3,
          pointHoverBackgroundColor: '#FFFFFF',
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      active: [], // Default state: no pre-highlighted elements on load
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false, // Custom HTML Tooltip guarantees z-index: 50 above canvas lines and points
          external: function(context) {
            renderAttendanceChartTooltip(context);
          },
          callbacks: {
            title: (items) => {
              const item = items[0];
              if (!item) return '';
              const tf = AppState.attendanceTimeframe || 'month';
              if (tf === 'week') {
                return `${item.label} (This Week)`;
              } else if (tf === 'month') {
                return `${item.label} ${MONTHS_LIST[CURRENT_MONTH_INDEX]} ${CURRENT_YEAR}`;
              } else {
                return `${item.label} ${CURRENT_YEAR}`;
              }
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false, drawBorder: false },
          ticks: {
            color: '#9CA3AF',
            font: { family: 'Inter', size: 11, weight: '500' },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: '#ECEAE4',
            borderDash: [2, 3],
            drawBorder: false
          },
          ticks: {
            color: '#9CA3AF',
            font: { family: 'Inter', size: 11 },
            precision: 0
          }
        }
      }
    }
  });
}

function toggleAttendanceTimeframeDropdown(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('attendance-timeframe-dropdown-menu');
  const chevron = document.getElementById('attendance-timeframe-chevron');
  if (menu) {
    const isClosed = menu.classList.toggle('hidden');
    if (chevron) {
      chevron.style.transform = isClosed ? 'rotate(0deg)' : 'rotate(180deg)';
    }
  }
}

function selectAttendanceTimeframe(timeframeId, event) {
  if (event) event.stopPropagation();
  AppState.attendanceTimeframe = timeframeId;

  const menu = document.getElementById('attendance-timeframe-dropdown-menu');
  const chevron = document.getElementById('attendance-timeframe-chevron');
  if (menu) menu.classList.add('hidden');
  if (chevron) chevron.style.transform = 'rotate(0deg)';

  // Hide any open tooltip on switch
  const tooltipEl = document.getElementById('attendance-chart-tooltip');
  if (tooltipEl) {
    tooltipEl.style.opacity = '0';
    tooltipEl.classList.add('hidden');
  }

  // If chart instance exists and canvas is present, update smoothly!
  const canvas = document.getElementById('attendance-vs-pass-canvas');
  if (canvas && window._attendanceChartInstance) {
    updateAttendanceVsPassChartSmoothly();
  } else {
    // Re-render card markup (e.g. if switching from empty state or canvas not initialized)
    const card = document.getElementById('attendance-chart-card');
    if (card) {
      card.innerHTML = renderAttendanceVsPassCardMarkup();
      initAttendanceVsPassChart();
    }
  }

  const selectedTf = ATTENDANCE_TIMEFRAMES.find(t => t.id === timeframeId);
  showToastNotification(`✓ Switched Attendance View to ${selectedTf ? selectedTf.label : timeframeId}`);
}

/**
 * Dynamic Re-rendering: Smoothly updates datasets, labels, and scales without full reload
 */
function updateAttendanceVsPassChartSmoothly() {
  const timeframe = AppState.attendanceTimeframe || 'month';
  const chartData = getAttendanceVsPassData(timeframe);
  const selectedTf = ATTENDANCE_TIMEFRAMES.find(t => t.id === timeframe) || ATTENDANCE_TIMEFRAMES[1];

  // Update label in dropdown button
  const labelEl = document.getElementById('attendance-selected-timeframe-label');
  if (labelEl) labelEl.textContent = selectedTf.label;

  // Update dropdown menu items checkmarks
  const menuEl = document.getElementById('attendance-timeframe-dropdown-menu');
  if (menuEl) {
    menuEl.innerHTML = ATTENDANCE_TIMEFRAMES.map(tf => {
      const isSelected = tf.id === timeframe;
      return `
        <button type="button" onclick="selectAttendanceTimeframe('${tf.id}', event)" class="w-full text-left px-3.5 py-2 flex items-center justify-between transition-colors ${isSelected ? 'font-bold text-[#0E4D45] bg-[#E8EFEE]/60' : 'text-[#4B5563] hover:bg-[#F8F6F1] font-medium'}">
          <div class="flex flex-col">
            <span class="text-xs ${isSelected ? 'font-bold text-[#0E4D45]' : 'text-[#141F1E]'}">${tf.label}</span>
            <span class="text-[10px] text-[#7A8684]">${tf.sub}</span>
          </div>
          ${isSelected ? '<span class="text-[#0E4D45] font-bold text-sm">✓</span>' : ''}
        </button>
      `;
    }).join('');
  }

  // Update AVG Passing Rate text
  const avgRateEl = document.getElementById('attendance-avg-pass-rate');
  if (avgRateEl) {
    avgRateEl.textContent = chartData.hasData ? (chartData.avgPassingRate + '%') : '—';
  }

  // Handle switching between empty state and canvas
  const canvas = document.getElementById('attendance-vs-pass-canvas');
  if (!chartData.hasData || !canvas) {
    const card = document.getElementById('attendance-chart-card');
    if (card) {
      card.innerHTML = renderAttendanceVsPassCardMarkup();
      initAttendanceVsPassChart();
    }
    return;
  }

  if (!window._attendanceChartInstance) {
    initAttendanceVsPassChart();
    return;
  }

  const chart = window._attendanceChartInstance;
  const records = chartData.records;
  const labels = records.map(r => r.label);
  const attendData = records.map(r => r.attend);
  const passedData = records.map(r => r.passed);

  // Update chart data
  chart.data.labels = labels;
  chart.data.datasets[0].data = attendData;
  chart.data.datasets[1].data = passedData;

  // Responsive styling per timeframe:
  if (timeframe === 'week') {
    chart.data.datasets[0].barThickness = 24;
    chart.data.datasets[0].maxBarThickness = 28;
    chart.data.datasets[0].borderRadius = 14;
    chart.data.datasets[1].pointRadius = 4.5;
    chart.data.datasets[1].pointHoverRadius = 6.5;
  } else if (timeframe === 'month') {
    chart.data.datasets[0].barThickness = records.length > 25 ? 6 : 10;
    chart.data.datasets[0].maxBarThickness = records.length > 25 ? 8 : 12;
    chart.data.datasets[0].borderRadius = 4;
    chart.data.datasets[1].pointRadius = 2.5;
    chart.data.datasets[1].pointHoverRadius = 5;
  } else {
    chart.data.datasets[0].barThickness = 20;
    chart.data.datasets[0].maxBarThickness = 22;
    chart.data.datasets[0].borderRadius = 16;
    chart.data.datasets[1].pointRadius = 4.5;
    chart.data.datasets[1].pointHoverRadius = 6.5;
  }

  // Dynamic axis scaling: clean auto-scaling with autoSkip and maxTicksLimit
  chart.options.scales.x.ticks.autoSkip = true;
  chart.options.scales.x.ticks.maxTicksLimit = (timeframe === 'year' ? 12 : 10);
  chart.options.scales.y.beginAtZero = true;
  delete chart.options.scales.y.max;
  delete chart.options.scales.y.suggestedMax;
  delete chart.options.scales.y.ticks.stepSize;

  // Update chart smoothly
  chart.update();
}

// Backward-compatible aliases for existing year functions
function toggleAttendanceYearDropdown(event) {
  toggleAttendanceTimeframeDropdown(event);
}

function selectAttendanceYear(year, event) {
  selectAttendanceTimeframe('year', event);
}

function initAttendanceDotMatrix() {
  initAttendanceVsPassChart();
}

// Global click listener to close timeframe dropdown
document.addEventListener('click', (e) => {
  const menu = document.getElementById('attendance-timeframe-dropdown-menu');
  const btn = document.getElementById('attendance-timeframe-dropdown-wrapper');
  if (menu && !menu.classList.contains('hidden') && btn && !btn.contains(e.target)) {
    menu.classList.add('hidden');
    const chevron = document.getElementById('attendance-timeframe-chevron');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  }
});

// ==========================================
// 6. MODULE 2: 12-MONTH FEE MATRIX VIEW & FIFO MODAL
// ==========================================

// ==========================================
// FAMILY PACKAGE (FLAT FAMILY FEE)
// ==========================================
// Some families pay one flat monthly fee for all children together
// (e.g. $50/mo total for 4 children), not a fee per child. A package
// stores the flat fee on every member student (familyPackage,
// familyPackageFee, prePackageFee) and splits it equally across the
// members in whole cents. It uses the existing student save path
// (dbSaveStudent / localStorage) — no new Firestore collection.
// Paid and advance months are never touched; 'not_enrolled' months
// keep feeDue 0. Removal restores each member's previous fee from
// prePackageFee. Fields are cleared to false/null (never deleted) so
// the Firestore merge-set actually removes them from the cloud doc.

function getFamilyMembers(familyId) {
  if (!familyId) return [];
  return (AppState.students || []).filter(s => s.familyId === familyId || s.familyTag === familyId);
}

// Returns the flat package fee (number) for a family, or null when the
// family has no package. Any member carrying familyPackage === true
// marks the whole family as packaged.
function getFamilyPackage(familyId) {
  const members = getFamilyMembers(familyId);
  const packaged = members.find(s => s.familyPackage === true);
  if (!packaged) return null;
  const fee = Number(packaged.familyPackageFee);
  return fee > 0 ? fee : null;
}

// Split a flat fee into whole-cent shares that sum EXACTLY to the fee:
// base = floor(totalCents / n), the leftover cents go one each to the
// first children. $50/4 -> [12.50 x4]; $50/3 -> [16.67, 16.67, 16.66].
function splitPackageFee(packageFee, count) {
  const totalCents = Math.round(Number(packageFee) * 100);
  const n = Math.max(1, Number(count) || 1);
  const base = Math.floor(totalCents / n);
  let remainder = totalCents - base * n;
  const shares = [];
  for (let i = 0; i < n; i++) {
    shares.push((base + (remainder > 0 ? 1 : 0)) / 100);
    if (remainder > 0) remainder--;
  }
  return shares;
}

// Display a fee amount without trailing ".00" ($50, $12.50, $16.67).
function formatFeeAmount(n) {
  const v = Number(n) || 0;
  return v.toFixed(2).replace(/\.00$/, '');
}

// Re-split the family's package equally across its current members and
// persist every member through the existing awaited save. Returns true
// when every cloud write succeeded.
async function recalcFamilyPackage(familyId) {
  const members = getFamilyMembers(familyId);
  const pkgFee = getFamilyPackage(familyId);
  if (!pkgFee || members.length === 0) return true;
  const shares = splitPackageFee(pkgFee, members.length);
  let cloudOk = true;
  for (let i = 0; i < members.length; i++) {
    const s = members[i];
    const share = shares[i];
    // Remember the pre-package fee once; never overwrite it with a share.
    if (s.prePackageFee === undefined || s.prePackageFee === null) {
      s.prePackageFee = Number(s.monthlyFee) || share;
    }
    s.familyPackage = true;
    s.familyPackageFee = pkgFee;
    s.monthlyFee = share;
    (s.months || []).forEach(m => {
      if (!m || m.status === 'paid' || m.status === 'advance' || m.status === 'not_enrolled') return;
      m.feeDue = share;
      m.remainingDue = Math.max(0, share - (Number(m.amountPaid) || 0));
    });
    const ok = await dbSaveStudent(s);
    if (!ok) cloudOk = false;
  }
  return cloudOk;
}

// Remove a family's package: restore each member's previous monthly fee
// (leave the current share when no previous fee was recorded), clear the
// package fields to false/null so the Firestore merge-set removes them,
// and re-price unpaid months. Returns true when every cloud write
// succeeded.
async function removeFamilyPackage(familyId) {
  const members = getFamilyMembers(familyId);
  let cloudOk = true;
  for (const s of members) {
    if (!s.familyPackage) continue;
    const prev = Number(s.prePackageFee);
    const fee = (prev && prev > 0) ? prev : (Number(s.monthlyFee) || 0);
    s.monthlyFee = fee;
    s.familyPackage = false;
    s.familyPackageFee = null;
    s.prePackageFee = null;
    (s.months || []).forEach(m => {
      if (!m || m.status === 'paid' || m.status === 'advance' || m.status === 'not_enrolled') return;
      m.feeDue = fee;
      m.remainingDue = Math.max(0, fee - (Number(m.amountPaid) || 0));
    });
    const ok = await dbSaveStudent(s);
    if (!ok) cloudOk = false;
  }
  return cloudOk;
}

// --- Family Package modal (state + open/close/save/remove) ---
let activeFamilyPackageId = null;

function openFamilyPackageModal(familyId) {
  const members = getFamilyMembers(familyId);
  if (members.length === 0) return;
  activeFamilyPackageId = familyId;
  const modal = document.getElementById('family-package-modal');
  const title = document.getElementById('family-package-modal-title');
  const feeInput = document.getElementById('family-package-fee-input');
  const currencySymbol = document.getElementById('family-package-currency-symbol');
  const removeBtn = document.getElementById('family-package-remove-btn');
  const guardian = members[0] ? (members[0].guardianName || members[0].lastName || 'Family') : 'Family';
  if (title) title.textContent = `Family Package — ${guardian} (${familyId})`;
  if (currencySymbol) currencySymbol.textContent = members[0]?.currency || '$';
  const existing = getFamilyPackage(familyId);
  if (feeInput) feeInput.value = existing ? String(existing) : '';
  if (removeBtn) removeBtn.classList.toggle('hidden', !existing);
  updateFamilyPackageModalPreview();
  if (modal) modal.classList.add('active');
}
window.openFamilyPackageModal = openFamilyPackageModal;

function closeFamilyPackageModal() {
  const modal = document.getElementById('family-package-modal');
  if (modal) modal.classList.remove('active');
  activeFamilyPackageId = null;
}
window.closeFamilyPackageModal = closeFamilyPackageModal;

function updateFamilyPackageModalPreview() {
  const preview = document.getElementById('family-package-preview-text');
  const feeInput = document.getElementById('family-package-fee-input');
  if (!preview || !activeFamilyPackageId) return;
  const members = getFamilyMembers(activeFamilyPackageId);
  const fee = Number(feeInput?.value) || 0;
  const currency = members[0]?.currency || '$';
  const n = members.length;
  const word = n === 1 ? 'child' : 'children';
  if (!fee || fee <= 0) {
    preview.textContent = `Split equally across ${n} ${word}.`;
    return;
  }
  const shares = splitPackageFee(fee, n);
  const allEqual = shares.every(s => s === shares[0]);
  const splitText = allEqual
    ? `${currency}${formatFeeAmount(shares[0])} each`
    : shares.map(s => `${currency}${formatFeeAmount(s)}`).join(', ');
  preview.textContent = `Split equally across ${n} ${word} (${splitText}). Each child's monthly fee becomes their share.`;
}
window.updateFamilyPackageModalPreview = updateFamilyPackageModalPreview;

async function saveFamilyPackage() {
  if (!activeFamilyPackageId) return;
  const feeInput = document.getElementById('family-package-fee-input');
  const fee = Number(feeInput?.value) || 0;
  if (!fee || fee <= 0 || isNaN(fee)) {
    showToastNotification('Please enter a valid flat monthly fee for the package.', 'error');
    return;
  }
  const familyId = activeFamilyPackageId;
  const members = getFamilyMembers(familyId);
  members.forEach(s => {
    if (s.prePackageFee === undefined || s.prePackageFee === null) {
      s.prePackageFee = Number(s.monthlyFee) || 0;
    }
    s.familyPackage = true;
    s.familyPackageFee = fee;
  });
  const cloudOk = await recalcFamilyPackage(familyId);
  closeFamilyPackageModal();
  renderApp();
  const currency = members[0]?.currency || '$';
  if (cloudOk) {
    showToastNotification(`Family Package ${currency}${formatFeeAmount(fee)}/mo saved for ${familyId} — split equally across ${members.length} ${members.length === 1 ? 'child' : 'children'}.`);
  } else {
    showToastNotification(`Could not save to cloud: ${firestoreSyncError || 'Firestore is not available'} — saved on this device only.`, 'error');
  }
}
window.saveFamilyPackage = saveFamilyPackage;

async function handleRemoveFamilyPackage() {
  if (!activeFamilyPackageId) return;
  const familyId = activeFamilyPackageId;
  const cloudOk = await removeFamilyPackage(familyId);
  closeFamilyPackageModal();
  renderApp();
  if (cloudOk) {
    showToastNotification(`Family Package removed for ${familyId} — each child's previous monthly fee was restored.`);
  } else {
    showToastNotification(`Could not save to cloud: ${firestoreSyncError || 'Firestore is not available'} — saved on this device only.`, 'error');
  }
}
window.handleRemoveFamilyPackage = handleRemoveFamilyPackage;

// --- Add Student form: Family Package note + share pre-fill ---
// Tracks the last share auto-filled into the fee field, so clearing the
// family tag can undo the pre-fill without touching a manual edit.
let lastPackageAutoShare = null;

function handleAddStudentFamilyTagChange() {
  const familyInput = document.getElementById('add-student-family-id');
  const feeInput = document.getElementById('add-student-fee');
  const note = document.getElementById('add-student-package-note');
  const raiseWrap = document.getElementById('add-student-package-raise');
  const raiseInput = document.getElementById('add-student-package-fee');
  const raiseCurrency = document.getElementById('add-student-package-currency');
  const raiseHint = document.getElementById('add-student-package-raise-hint');
  if (!familyInput || !feeInput || !note) return;
  const tag = (familyInput.value || '').trim();
  const pkgFee = tag ? getFamilyPackage(tag) : null;
  if (!pkgFee) {
    // Undo only an auto-filled share; never touch a manually typed fee.
    if (lastPackageAutoShare !== null && Number(feeInput.value) === lastPackageAutoShare) {
      feeInput.value = '';
    }
    lastPackageAutoShare = null;
    note.textContent = '';
    note.classList.add('hidden');
    if (raiseWrap) raiseWrap.classList.add('hidden');
    if (raiseInput) raiseInput.value = '';
    return;
  }
  const members = getFamilyMembers(tag);
  const newCount = members.length + 1;
  const share = splitPackageFee(pkgFee, newCount)[0];
  const currency = members[0]?.currency || '$';
  note.textContent = `Family Package ${currency}${formatFeeAmount(pkgFee)}/mo — this child's share ${currency}${formatFeeAmount(share)} (auto-set)`;
  note.classList.remove('hidden');
  feeInput.value = String(share);
  lastPackageAutoShare = share;
  // Family Package raise at enrolment: a new child joining is when the
  // academy asks the family to raise the flat fee a little. Offer the
  // current fee here, editable; the share above updates live as it is
  // typed (see handleAddStudentPackageFeeChange).
  if (raiseWrap) raiseWrap.classList.remove('hidden');
  if (raiseInput) raiseInput.value = String(pkgFee);
  if (raiseCurrency) raiseCurrency.textContent = currency;
  if (raiseHint) raiseHint.textContent = `New child is joining — raise the package fee here if the family agreed (leave it to keep ${currency}${formatFeeAmount(pkgFee)}).`;
}
window.handleAddStudentFamilyTagChange = handleAddStudentFamilyTagChange;

// Live share update when the admin raises the package fee in the Add
// Student form. While the field is empty or invalid, the note falls back
// to the stored package fee and the field itself is left alone (never
// reset it mid-typing). Only an auto-filled share in Monthly Fee is
// overwritten — a manually typed fee is never touched.
function handleAddStudentPackageFeeChange() {
  const familyInput = document.getElementById('add-student-family-id');
  const feeInput = document.getElementById('add-student-fee');
  const note = document.getElementById('add-student-package-note');
  const raiseInput = document.getElementById('add-student-package-fee');
  if (!familyInput || !feeInput || !note || !raiseInput) return;
  const tag = (familyInput.value || '').trim();
  const currentPkgFee = tag ? getFamilyPackage(tag) : null;
  if (!currentPkgFee) return;
  const typed = (raiseInput.value || '').trim();
  const newFee = Number(typed);
  const effectiveFee = (typed !== '' && !isNaN(newFee) && newFee > 0) ? newFee : currentPkgFee;
  const members = getFamilyMembers(tag);
  const newCount = members.length + 1;
  const share = splitPackageFee(effectiveFee, newCount)[0];
  const currency = members[0]?.currency || '$';
  note.textContent = `Family Package ${currency}${formatFeeAmount(effectiveFee)}/mo — this child's share ${currency}${formatFeeAmount(share)} (auto-set)`;
  if (feeInput.value === '' || (lastPackageAutoShare !== null && Number(feeInput.value) === lastPackageAutoShare)) {
    feeInput.value = String(share);
  }
  lastPackageAutoShare = share;
}
window.handleAddStudentPackageFeeChange = handleAddStudentPackageFeeChange;

/**
 * Render Family Header Row in Accordion Grouped Ledger Table (Stripe Billing Minimalist Standard)
 */
function renderFamilyLedgerHeaderRow(fam, isCollapsed = false) {
  const pkgFee = getFamilyPackage(fam.familyId);
  const pkgShare = pkgFee ? splitPackageFee(pkgFee, fam.students.length)[0] : 0;
  return `
    <tr class="family-group-header bg-[#FDFBF7] border-t-2 border-[#D1D5DB] border-b border-[#E5E7EB] select-none hover:bg-[#F8F5EE] transition-colors cursor-pointer" onclick="toggleFamilyCollapse('${fam.familyId}', event)">
      <td colspan="16" class="py-3 px-4 border-t-2 border-[#D1D5DB] border-b border-[#E5E7EB]">
        <div class="flex items-center justify-between gap-4">
          <!-- Left side of row: Dropdown chevron, FAM badge, Guardian Name -->
          <div class="flex items-center gap-3">
            <button type="button" 
              onclick="toggleFamilyCollapse('${fam.familyId}', event)" 
              class="w-5 h-5 rounded flex items-center justify-center text-[#9CA3AF] hover:text-[#0E4D45] hover:bg-black/5 transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-0'} cursor-pointer" 
              title="${isCollapsed ? 'Expand family rows' : 'Collapse family rows'}">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <span class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white text-[#0E4D45] border border-[#E5E7EB] shadow-2xs">${fam.familyId}</span>
            <span class="text-xs font-bold text-[#141F1E]">${fam.guardianName}</span>
          </div>

          <!-- Right side of row: Combined Total Due & Subtle Secondary Button -->
          <div class="flex items-center gap-4" onclick="event.stopPropagation()">
            ${pkgFee ? `<span class="text-[11px] font-semibold text-[#0E4D45] bg-[#E8EFEE] border border-[#0E4D45]/20 rounded-md px-2 py-0.5 whitespace-nowrap">${familyPackagePKRHtml(fam, pkgFee, pkgShare)}</span>` : ''}
            <div class="flex items-center gap-1.5 text-xs">
              <span class="text-[#6B7280] text-[11px]">Combined Due:</span>
              <span class="font-bold ${fam.totalDue > 0 ? 'text-red-600' : 'text-[#065F46]'}">
                ${fam.totalDue > 0 ? familyDuePKRHtml(fam) : 'Clear'}
              </span>
            </div>
            <button onclick="openFamilyPackageModal('${fam.familyId}')" 
              class="px-3.5 py-1 text-xs font-semibold rounded-lg bg-white hover:bg-[#F9FAFB] text-[#141F1E] hover:text-[#0E4D45] border border-[#D1D5DB] transition-all shadow-2xs cursor-pointer whitespace-nowrap">
              Package
            </button>
            <button onclick="openReceiveFeeModal('${fam.familyId}')" 
              class="px-3.5 py-1 text-xs font-semibold rounded-lg bg-white hover:bg-[#F9FAFB] text-[#141F1E] hover:text-[#0E4D45] border border-[#D1D5DB] transition-all shadow-2xs cursor-pointer whitespace-nowrap">
              Pay Group Invoice
            </button>
          </div>
        </div>
      </td>
    </tr>
  `;
}

/**
 * Render Student Fee Matrix Row (Flat or Child Row of Family)
 */
function renderStudentFeeLedgerRow(student, isChildOfFamily = false, isLastChild = false) {
  const balanceDue = getStudentBalanceDue(student);
  const isLedgerMenuOpen = AppState.activeLedgerActionMenuId === student.id;

  return `
    <tr class="family-child-row bg-white hover:bg-[#FBF9F5] transition-colors ${isLastChild ? 'last-child border-b border-[#E5E7EB]' : 'border-b border-[#F1EFEA]'}">
      <!-- Student Details: Clean Visual Hierarchy (Stripe/Linear Standard) -->
      <td class="py-3 pr-3 whitespace-nowrap ${isChildOfFamily ? 'pl-10' : 'pl-3'} ${isLastChild ? 'border-b border-[#E5E7EB]' : ''}">
        <div class="flex items-center gap-3">
          <img 
            src="${student.avatar ? (student.avatar.includes('ui-avatars.com') ? getAvatarUrl(`${student.firstName} ${student.lastName || ''}`) : student.avatar) : getAvatarUrl(`${student.firstName} ${student.lastName || ''}`)}" 
            alt="${student.firstName}" 
            class="w-8 h-8 rounded-full object-cover shrink-0 border border-[#ECEAE4]" 
            onerror="this.onerror=null; this.src='${getAvatarUrl(`${student.firstName} ${student.lastName || ''}`)}';" 
          />
          <div class="min-w-0">
            <!-- Primary Line: Name + ID + Optional Family Tag -->
            <div class="font-bold text-xs text-[#141F1E] flex items-center gap-1.5">
              <span>${student.firstName} ${student.lastName || ''}</span>
              <span class="text-[10px] text-gray-400 font-normal">(${student.id})</span>
              ${!isChildOfFamily && (student.familyId || student.familyTag) ? `
                <button type="button" onclick="filterByFamilyTag('${student.familyId || student.familyTag}', event)" 
                  class="text-[9px] px-1.5 py-0.5 rounded-md bg-gray-100 hover:bg-[#0E4D45] hover:text-white text-gray-500 font-medium transition-all cursor-pointer" 
                  title="Filter by family group ${student.familyId || student.familyTag}">
                  ${student.familyId || student.familyTag}
                </button>
              ` : ''}
            </div>
            <!-- Secondary Line: Muted Course & Country -->
            <div class="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5 font-normal">
              <span class="truncate max-w-[170px]">${student.course || 'Quran Studies'}</span>
              <span class="text-gray-300">·</span>
              <span>${student.country || 'Global'}</span>
            </div>
          </div>
        </div>
      </td>

      <!-- Monthly Fee & Balance -->
      <td class="py-3 pr-3 whitespace-nowrap">
        <div class="font-semibold text-xs text-[#141F1E]">${studentFeePKRHtml(student)}<span class="text-[10px] text-gray-400 font-normal">/mo</span></div>
        <div class="text-[11px] mt-0.5 font-medium ${balanceDue > 0 ? 'text-red-600' : 'text-emerald-600'}">
          ${balanceDue > 0 ? studentDuePKRHtml(student, balanceDue) : 'Clear'}
        </div>
      </td>

      <!-- Status Badge (Sleek Minimalist Dot & Text) -->
      <td class="py-3 pr-3 whitespace-nowrap">
        ${renderStudentLedgerStatusPill(student)}
      </td>

      <!-- 12 Clean Month Cells: Subtle dot + amount, breathing room (No heavy solid blocks) -->
      ${student.months.map((m, idx) => {
        let cellContent = '';
        const statusMap = { paid: 'Paid', partial: 'Partial', advance: 'Advance', defaulter: 'Overdue', upcoming: 'Upcoming', not_enrolled: 'Not Enrolled' };
        const cleanStatus = statusMap[m.status] || 'Not Enrolled';
        let tooltip = `${m.month} ${CURRENT_YEAR}: ${cleanStatus}`;
        const cellPKR = (m.status === 'defaulter')
          ? convertToPKR(m.feeDue || student.monthlyFee, student.currencyCode)
          : getStudentMonthPaidPKR(student, idx);
        const cellPKRText = cellPKR.hasRate ? ' (' + formatPKRAmount(cellPKR.pkr) + ')' : ' (rate not set)';
        // PKR-first cell label: PKR on line 1, original currency tiny on line 2.
        const cellOrigAmount = (m.status === 'defaulter') ? (m.feeDue || student.monthlyFee) : m.amountPaid;
        const cellOrigText = student.currency + cellOrigAmount;
        const cellLabelHtml = cellPKR.hasRate
          ? '<span class="flex flex-col items-center leading-none gap-0.5"><span>' + formatPKRAmount(cellPKR.pkr) + '</span><span class="text-[9px] font-normal opacity-70">(' + cellOrigText + ')</span></span>'
          : '<span class="flex flex-col items-center leading-none gap-0.5"><span>' + cellOrigText + '</span><span class="text-[9px] font-normal opacity-70">rate not set</span></span>';
        
        if (m.status === 'paid') {
          cellContent = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>${cellLabelHtml}`;
          tooltip += ` - Paid ${student.currency}${m.amountPaid}${cellPKRText}`;
          const rcpt = m.receiptNo || '';
          const pDate = m.paymentDate || 'Nov 24, 2026';
          const pMethod = m.paymentMethod || 'Online Card (Stripe)';
          if (rcpt) {
            tooltip += ` • Receipt #${rcpt} (${pDate}) via ${pMethod}`;
          }
        } else if (m.status === 'partial') {
          cellContent = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>${cellLabelHtml}`;
          tooltip += ` - Partial: ${student.currency}${m.amountPaid}${cellPKRText} / Remaining: ${student.currency}${m.remainingDue}`;
        } else if (m.status === 'advance') {
          cellContent = `<span class="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0"></span>${cellLabelHtml}`;
          tooltip += ` - Advance: ${student.currency}${m.amountPaid}${cellPKRText}`;
        } else if (m.status === 'defaulter') {
          cellContent = `<span class="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>${cellLabelHtml}`;
          tooltip += ` - Overdue: ${student.currency}${m.feeDue}${cellPKRText}`;
        } else {
          cellContent = `<span class="text-gray-300 font-normal">—</span>`;
          tooltip += ` - Not yet due`;
        }

        const isCurrentCol = idx === CURRENT_MONTH_INDEX;
        return `
          <td class="py-2.5 px-1 text-center ${isCurrentCol ? 'bg-[#0E4D45]/[0.02]' : ''}">
            <div onclick="openMonthDetailModal('${student.id}', ${idx})" 
                 title="${tooltip} (Click to manage)" 
                 class="month-cell ${m.status} ${isCurrentCol ? 'ring-1 ring-[#0E4D45]/30' : ''}">
              ${cellContent}
            </div>
          </td>
        `;
      }).join('')}

      <!-- Row Action: Clean 3-dots action menu, NO redundant Sibling/Household badge -->
      <td class="py-3.5 text-right pr-3 whitespace-nowrap relative ledger-action-menu-container">
        <div class="flex items-center justify-end gap-1.5">
          ${!isChildOfFamily ? `
            <button onclick="openReceiveFeeModal('${student.id}')" 
              class="px-2.5 py-1 text-[11px] font-semibold rounded-full bg-[#0E4D45] text-white hover:bg-[#14534B] transition-colors whitespace-nowrap shadow-2xs cursor-pointer">
              + Pay
            </button>
          ` : ''}
          <button onclick="toggleLedgerRowActionMenu('${student.id}', event)" 
            class="w-7 h-7 rounded-full flex items-center justify-center text-[#9CA3AF] hover:text-[#141F1E] hover:bg-[#F3F4F6] transition-all cursor-pointer font-bold leading-none inline-flex" 
            title="More actions for ${student.firstName}">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
          </button>
        </div>

        ${isLedgerMenuOpen ? `
          <div class="absolute right-0 top-11 rounded-2xl shadow-xl border border-[#ECEAE4] p-1.5 w-52 bg-white z-50 text-left animate-in fade-in zoom-in-95 duration-150">
            <button onclick="closeLedgerRowActionMenu(); openReceiveFeeModal('${student.id}')" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#141F1E] hover:bg-[#F8F6F1] transition-colors cursor-pointer whitespace-nowrap">
              <svg class="w-4 h-4 text-[#0E4D45] shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
              <span>Receive Fee</span>
            </button>
            <button onclick="closeLedgerRowActionMenu(); openWhatsAppFeeReminder('${student.id}')" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#141F1E] hover:bg-[#F8F6F1] transition-colors cursor-pointer whitespace-nowrap">
              <svg class="w-4 h-4 text-[#25D366] shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
              <span>WhatsApp Reminder</span>
            </button>
            <button onclick="closeLedgerRowActionMenu(); filterByFamilyTag('${student.familyId || student.familyTag}')" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#141F1E] hover:bg-[#F8F6F1] transition-colors cursor-pointer whitespace-nowrap">
              <svg class="w-4 h-4 text-[#7A8684] shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
              <span>Filter Family (${student.familyId || student.familyTag})</span>
            </button>
            <button onclick="closeLedgerRowActionMenu(); openMonthDetailModal('${student.id}', ${CURRENT_MONTH_INDEX})" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#141F1E] hover:bg-[#F8F6F1] transition-colors cursor-pointer whitespace-nowrap">
              <svg class="w-4 h-4 text-[#7A8684] shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
              <span>Inspect ${MONTHS_LIST[CURRENT_MONTH_INDEX]} Details</span>
            </button>
          </div>
        ` : ''}
      </td>
    </tr>
  `;
}

function renderAdminFeeMatrixView() {
  const isFamilyGrouped = Boolean(AppState.groupByFamily || AppState.selectedFilter === 'family');

  // Filter students based on selection
  let filtered = AppState.students.filter(student => {
    const feeStatus = getStudentFeeStatus(student);
    if (AppState.selectedFilter === 'paid' && feeStatus.code !== 'paid') return false;
    if (AppState.selectedFilter === 'partial' && feeStatus.code !== 'partial') return false;
    if (AppState.selectedFilter === 'advance' && feeStatus.code !== 'advance') return false;
    if (AppState.selectedFilter === 'defaulter' && feeStatus.code !== 'defaulter') return false;
    if (AppState.selectedCurrency !== 'all' && student.currencyCode !== AppState.selectedCurrency) return false;
    if (AppState.searchQuery) {
      const q = AppState.searchQuery.toLowerCase();
      return student.firstName.toLowerCase().includes(q) ||
             student.lastName.toLowerCase().includes(q) ||
             student.id.toLowerCase().includes(q) ||
             (student.familyId || '').toLowerCase().includes(q) ||
             (student.familyTag || '').toLowerCase().includes(q) ||
             (student.guardianName || '').toLowerCase().includes(q);
    }
    return true;
  });

  // Calculate active month distribution stats across filtered students
  let monthPaidCount = 0;
  let monthPartialCount = 0;
  let monthOverdueCount = 0;
  // Month total in PKR: each student's paid amount uses the frozen PKR of
  // its covering payment where recorded, else the current rate. Amounts
  // whose currency has no rate are excluded, never mixed into the total.
  let monthTotalCollectedPKR = 0;
  const monthTotalExcludedCodes = {};

  filtered.forEach(s => {
    const m = s.months ? s.months[CURRENT_MONTH_INDEX] : null;
    if (m) {
      if (m.status === 'paid' || m.status === 'advance') {
        monthPaidCount++;
        const r = getStudentMonthPaidPKR(s, CURRENT_MONTH_INDEX);
        if (r.hasRate) monthTotalCollectedPKR += r.pkr;
        else monthTotalExcludedCodes[s.currencyCode || 'unknown'] = true;
      } else if (m.status === 'partial') {
        monthPartialCount++;
        const r = getStudentMonthPaidPKR(s, CURRENT_MONTH_INDEX);
        if (r.hasRate) monthTotalCollectedPKR += r.pkr;
        else monthTotalExcludedCodes[s.currencyCode || 'unknown'] = true;
      } else if (m.status === 'defaulter') {
        monthOverdueCount++;
      }
    }
  });
  const monthTotalExcludedList = Object.keys(monthTotalExcludedCodes);

  return `
    <div class="ts-card p-3.5 sm:p-6 mb-8 overflow-hidden">
      
      <!-- Top Title & Quick Action Bar -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 pb-4 border-b border-[#ECEAE4]">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="text-base sm:text-xl font-bold text-[#141F1E] leading-tight">12-Month Fee Ledger <span class="text-[#0E4D45]">(${CURRENT_YEAR})</span></h2>
            <span class="ts-badge ts-badge-paid text-[10px] sm:text-xs">Admin Access</span>
          </div>
          <p class="text-xs text-[#7A8684] mt-1 hidden sm:block">
            Automated fee settlement, multi-currency ledger, and family group sibling accounting.
          </p>
        </div>

        <!-- Primary Action Button: Receive Fee (Full-width on mobile, auto-width on desktop) -->
        <div class="w-full sm:w-auto mt-2 sm:mt-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <button onclick="openCurrencySettingsModal()" class="w-full sm:w-auto px-4 py-2.5 sm:py-2 text-xs font-bold rounded-full bg-white border border-[#0E4D45] text-[#0E4D45] hover:bg-[#E8EFEE] transition-colors shadow-sm flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap" title="Exchange rates — all amounts shown in PKR">
            <span>Currency Settings</span>
          </button>
          <button onclick="openReceiveFeeModal()" class="w-full sm:w-auto px-5 py-2.5 sm:py-2 text-xs font-bold rounded-full bg-[#0E4D45] text-white hover:bg-[#14534B] transition-colors shadow-sm flex items-center justify-center gap-1.5 cursor-pointer">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
            <span>Receive Fee</span>
          </button>
        </div>
      </div>

      <!-- PART 2: DESKTOP LINEAR GRID TOOLBAR (Consolidated to ONE Single Row below Title) -->
      <div class="hidden md:flex items-center justify-between gap-3 mb-3 pb-3 border-b border-[#ECEAE4]">
        
        <!-- Left: Search Box with Inline Filter Button -->
        <div class="flex items-center gap-2 flex-1 max-w-md relative" id="desktop-fee-filter-container">
          
          <!-- Search Input -->
          <div class="relative flex-1">
            <input 
              type="text" 
              id="fee-matrix-search-input"
              placeholder="Search student..." 
              oninput="setSearchQuery(this.value)" 
              onkeyup="setSearchQuery(this.value)"
              value="${AppState.searchQuery}" 
              class="h-9 w-full text-xs bg-white border border-[#ECEAE4] rounded-xl pl-8 pr-7 text-[#141F1E] outline-none focus:border-[#0E4D45] shadow-2xs font-medium transition-colors"
            />
            <svg class="w-3.5 h-3.5 text-[#7A8684] absolute left-2.5 top-3 pointer-events-none" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
            ${AppState.searchQuery ? `
              <button onclick="setSearchQuery('')" class="absolute right-2 top-2.5 text-[#7A8684] hover:text-[#141F1E] text-xs font-bold cursor-pointer" title="Clear search">✕</button>
            ` : ''}
          </div>

          <!-- Inline Filter Button -->
          <button 
            type="button" 
            id="fee-filter-dropdown-btn"
            onclick="toggleFeeFilterDropdown(event)" 
            class="relative h-9 px-3 rounded-xl border border-[#ECEAE4] bg-white hover:bg-[#F8F6F1] flex items-center justify-center gap-1.5 text-xs font-semibold text-[#141F1E] shadow-2xs shrink-0 cursor-pointer transition-colors"
            title="Filter Ledger (Status, Family Group, Currency)"
          >
            <svg class="w-3.5 h-3.5 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            <span>Filter</span>
            ${(AppState.selectedFilter !== 'all' || AppState.selectedCurrency !== 'all' || !AppState.groupByFamily) ? `
              <span class="w-2 h-2 rounded-full bg-[#0E4D45]"></span>
            ` : ''}
          </button>
        </div>

        <!-- Right: Active Academic Period Display (Clean label without duplicate Previous/Next steppers) -->
        <div class="inline-flex items-center h-9 rounded-xl border border-[#ECEAE4] bg-white px-3 shadow-2xs">
          <span class="text-xs font-bold text-[#141F1E] whitespace-nowrap">${FULL_MONTHS_LIST[CURRENT_MONTH_INDEX]} ${CURRENT_YEAR}</span>
        </div>
      </div>

      <!-- Collapsible Desktop Filter Panel (Does NOT cover table headers or legend) -->
      <div id="fee-filter-dropdown-menu" class="${AppState.isFeeFilterOpen ? '' : 'hidden'} mb-4 p-4 bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4] transition-all text-[#141F1E]">
        <div class="flex items-center justify-between pb-2.5 mb-3 border-b border-[#ECEAE4]">
          <span class="text-xs font-bold text-[#141F1E]">Filter Ledger</span>
          <div class="flex items-center gap-3">
            ${(AppState.selectedFilter !== 'all' || AppState.selectedCurrency !== 'all' || !AppState.groupByFamily) ? `
              <button type="button" onclick="resetFeeFilters();" class="text-[11px] font-semibold text-[#0E4D45] hover:underline cursor-pointer">Reset Filters</button>
            ` : ''}
            <button type="button" onclick="closeFeeFilterDropdown();" class="text-[#7A8684] hover:text-[#141F1E] text-xs font-bold cursor-pointer" title="Close Filters">✕</button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <!-- Status Filter Pills -->
          <div>
            <span class="text-xs font-semibold text-[#141F1E] block mb-1.5">Payment Status</span>
            <div class="flex gap-1.5">
              ${[
                { id: 'all', label: `All (${AppState.students ? AppState.students.length : 0})` },
                { id: 'paid', label: 'Paid' },
                { id: 'partial', label: 'Partial' },
                { id: 'advance', label: 'Advance' },
                { id: 'defaulter', label: 'Overdue' }
              ].map(s => `
                <button 
                  type="button" 
                  onclick="setFeeFilter('${s.id}')" 
                  class="flex-1 min-w-0 h-9 px-1 rounded-xl text-xs font-semibold transition-all cursor-pointer border flex items-center justify-center whitespace-nowrap ${AppState.selectedFilter === s.id ? 'bg-[#0E4D45] text-white border-[#0E4D45] shadow-xs' : 'bg-white text-gray-700 border-[#ECEAE4] hover:bg-[#F8F6F1]'}"
                >
                  ${s.label}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Family Group Toggle -->
          <div>
            <span class="text-xs font-semibold text-[#141F1E] block mb-1.5">Family Group</span>
            <div class="flex items-center justify-between h-9">
              <span class="text-[10px] text-gray-500">Group sibling accounts together</span>
              <button 
                type="button" 
                role="switch" 
                aria-checked="${isFamilyGrouped ? 'true' : 'false'}" 
                onclick="toggleGroupByFamily()" 
                class="flex items-center gap-2 cursor-pointer shrink-0"
              >
                <div class="transition-colors relative" style="width: 28px; height: 16px; border-radius: 9999px; background-color: ${isFamilyGrouped ? '#0E4D45' : '#CBD5E1'}; position: relative;">
                  <div class="transition-all shadow-xs" style="width: 12px; height: 12px; border-radius: 9999px; background-color: #FFFFFF; position: absolute; top: 2px; left: ${isFamilyGrouped ? '14px' : '2px'};"></div>
                </div>
                <span class="text-[11px] font-bold ${isFamilyGrouped ? 'text-[#0E4D45]' : 'text-gray-400'}">${isFamilyGrouped ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

          <!-- Currency Filter -->
          <div>
            <span class="text-xs font-semibold text-[#141F1E] block mb-1.5">Currency</span>
            <select 
              onchange="setCurrencyFilter(this.value)" 
              class="h-9 w-full text-xs bg-white border border-[#ECEAE4] rounded-xl px-2.5 text-[#141F1E] font-medium outline-none focus:border-[#0E4D45] cursor-pointer shadow-2xs"
            >
              <option value="all" ${AppState.selectedCurrency === 'all' ? 'selected' : ''}>All Currencies</option>
              ${ledgerCurrencyFilterCodes().map(c => `<option value="${c}" ${AppState.selectedCurrency === c ? 'selected' : ''}>${getCurrencySymbol(c)} ${c}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- PART 2: DESKTOP EMBEDDED LEGEND & STATS ROW (Requirement 3) -->
      <div class="hidden md:flex items-center justify-between gap-4 text-xs mb-4 text-[#7A8684] flex-wrap">
        <div class="flex items-center gap-3">
          <span class="text-xs font-semibold text-[#7A8684]">Legend:</span>
          <div class="flex items-center gap-1.5 font-medium text-[#141F1E]"><span class="w-2 h-2 rounded-full bg-emerald-500"></span><span>Paid</span></div>
          <div class="flex items-center gap-1.5 font-medium text-[#141F1E]"><span class="w-2 h-2 rounded-full bg-amber-500"></span><span>Partial</span></div>
          <div class="flex items-center gap-1.5 font-medium text-[#141F1E]"><span class="w-2 h-2 rounded-full bg-teal-500"></span><span>Advance</span></div>
          <div class="flex items-center gap-1.5 font-medium text-[#141F1E]"><span class="w-2 h-2 rounded-full bg-red-500"></span><span>Overdue</span></div>
          <div class="flex items-center gap-1.5 font-medium text-[#9CA3AF]"><span class="w-2 h-2 rounded-full bg-gray-300"></span><span>Upcoming</span></div>
        </div>

        <div class="flex items-center gap-2.5 text-xs">
          <span class="text-emerald-700 font-semibold">${monthPaidCount} Paid</span>
          <span class="text-gray-300">·</span>
          <span class="text-amber-700 font-semibold">${monthPartialCount} Partial</span>
          <span class="text-gray-300">·</span>
          <span class="text-red-700 font-semibold">${monthOverdueCount} Overdue</span>
          <span class="text-gray-300">·</span>
          <span class="text-[#0E4D45] font-bold">${formatPKRAmount(monthTotalCollectedPKR)} Month Total</span>${monthTotalExcludedList.length > 0 ? `<span class="text-gray-300">·</span><span class="text-amber-700 font-semibold">${monthTotalExcludedList.join(', ')} excluded — rate not set</span>` : ''}
        </div>
      </div>

      <!-- PART 3: MOBILE STACKED TOOLBAR (Requirements 1, 2, 3) -->
      <div class="md:hidden space-y-2.5 mb-3">
        <!-- Search field + inline Filter ⚙️ button -->
        <div class="flex items-center gap-2 w-full">
          <div class="relative flex-1 min-w-0">
            <input 
              type="text" 
              id="fee-matrix-mobile-search-input"
              placeholder="Search student or ID..." 
              oninput="setSearchQuery(this.value)" 
              onkeyup="setSearchQuery(this.value)"
              value="${AppState.searchQuery}" 
              class="h-10 w-full min-w-0 text-xs bg-white border border-[#ECEAE4] rounded-xl pl-8 pr-7 text-[#141F1E] outline-none focus:border-[#0E4D45] shadow-2xs font-medium"
            />
            <svg class="w-3.5 h-3.5 text-[#7A8684] absolute left-2.5 top-3.5 pointer-events-none" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
            ${AppState.searchQuery ? `
              <button onclick="setSearchQuery('')" class="absolute right-2.5 top-2.5 text-[#7A8684] hover:text-[#141F1E] text-xs font-bold cursor-pointer" title="Clear search">✕</button>
            ` : ''}
          </div>

          <!-- Inline Filter ⚙️ Icon Button -->
          <button 
            type="button" 
            onclick="openFeeFilterBottomSheet()" 
            class="relative h-10 px-3 rounded-xl border border-[#ECEAE4] bg-white hover:bg-[#F8F6F1] flex items-center justify-center gap-1.5 text-xs font-semibold text-[#141F1E] shadow-2xs shrink-0 cursor-pointer transition-colors"
            title="Open Filter Sheet"
          >
            <svg class="w-4 h-4 text-[#0E4D45] shrink-0" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            <span class="text-xs">Filter</span>
            ${(AppState.selectedFilter !== 'all' || AppState.selectedCurrency !== 'all' || !AppState.groupByFamily) ? `
              <span class="w-1.5 h-1.5 rounded-full bg-[#0E4D45]"></span>
            ` : ''}
          </button>
        </div>

        <!-- Active Period Label (Clean label without duplicate Previous/Next steppers) -->
        <div class="flex items-center justify-center w-full h-8 px-3 rounded-xl bg-white border border-[#ECEAE4] shadow-2xs">
          <span class="text-xs font-bold text-[#141F1E] tracking-tight">${FULL_MONTHS_LIST[CURRENT_MONTH_INDEX]} ${CURRENT_YEAR}</span>
        </div>

        <!-- Compact Stats: Mini-legend and quick counts in a tiny single-line flex block -->
        <div class="flex items-center justify-between text-[10px] text-[#7A8684] py-1.5 px-2.5 rounded-xl bg-[#F8F6F1] border border-[#ECEAE4]">
          <div class="flex items-center gap-1.5 truncate">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span><span class="font-bold text-[#141F1E]">${monthPaidCount}</span> Paid
            <span class="text-gray-300">·</span>
            <span class="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span><span class="font-bold text-[#141F1E]">${monthPartialCount}</span> Partial
            <span class="text-gray-300">·</span>
            <span class="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span><span class="font-bold text-[#141F1E]">${monthOverdueCount}</span> Overdue
          </div>
          <div class="font-bold text-[#0E4D45] shrink-0 pl-2">
            ${formatPKRAmount(monthTotalCollectedPKR)} Total
          </div>
        </div>
      </div>

      <!-- Desktop: 12-Month Matrix Visual Table (Hidden on Mobile) -->
      <div class="hidden md:block overflow-x-auto w-full max-w-full rounded-2xl touch-pan-x">
        <table class="w-full text-left border-collapse min-w-[980px]">
          <thead>
            <tr class="border-b border-[#ECEAE4] text-[11px] font-semibold text-[#7A8684]">
              <th class="pb-3 w-56 text-[11px] font-semibold text-[#7A8684]">Student & Family</th>
              <th class="pb-3 w-28 text-[11px] font-semibold text-[#7A8684]">Monthly Fee</th>
              <th class="pb-3 w-24 text-[11px] font-semibold text-[#7A8684]">Status</th>
              <!-- 12 Months Columns -->
              ${MONTHS_LIST.map((m, idx) => `
                <th class="pb-3 text-center w-12 select-none">
                  <button type="button" onclick="setAcademyMonthYear(${idx}, CURRENT_YEAR)" title="Switch academic period to ${FULL_MONTHS_LIST[idx]} ${CURRENT_YEAR}" class="inline-block px-1.5 py-0.5 rounded-md text-[11px] font-semibold cursor-pointer transition-colors ${idx === CURRENT_MONTH_INDEX ? 'bg-[#0E4D45] text-white shadow-xs' : 'text-[#7A8684] hover:bg-[#E8EFEE] hover:text-[#0E4D45]'}">
                    ${m}
                  </button>
                </th>
              `).join('')}
              <th class="pb-3 text-right w-28 text-[11px] font-semibold text-[#7A8684]">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#ECEAE4] text-xs">
            ${(() => {
              if (!AppState.students || AppState.students.length === 0) {
                return `
                  <tr>
                    <td colspan="16" class="py-16 text-center bg-[#F8F6F1]/50">
                      <div class="max-w-md mx-auto flex flex-col items-center">
                        <div class="w-12 h-12 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mb-3">
                          <svg class="w-6 h-6 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"/></svg>
                        </div>
                        <p class="text-xs font-bold text-[#141F1E]">No active students found in fee ledger.</p>
                        <p class="text-[11px] text-[#7A8684] mt-1">Enroll your first student in the directory to activate the 12-month billing matrix and fee ledger.</p>
                        <button onclick="setNavTab('students')" class="mt-4 px-4 py-2 text-xs font-bold rounded-full bg-[#0E4D45] text-white hover:bg-[#14534B] shadow-sm flex items-center gap-1.5 cursor-pointer">
                          <span>Go to Student Directory →</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }
              if (isFamilyGrouped) {
                const famMap = {};
                filtered.forEach(s => {
                  const famId = s.familyId || s.familyTag || 'FAM-101';
                  if (!famMap[famId]) {
                    famMap[famId] = {
                      familyId: famId,
                      guardianName: s.guardianName || 'Guardian',
                      email: s.email || '—',
                      phone: s.phone || '—',
                      country: s.country || 'Global',
                      currency: s.currency || '$',
                      students: [],
                      totalMonthlyFee: 0,
                      totalDue: 0
                    };
                  }
                  famMap[famId].students.push(s);
                  famMap[famId].totalMonthlyFee += s.monthlyFee || 0;
                  famMap[famId].totalDue += getStudentBalanceDue(s);
                });

                const familyList = Object.values(famMap);
                if (familyList.length === 0) {
                  return `
                    <tr>
                      <td colspan="16" class="py-12 text-center text-[#7A8684]">
                        No family records match the selected filter.
                      </td>
                    </tr>
                  `;
                }

                return familyList.map(fam => {
                  const isCollapsed = Boolean(AppState.collapsedFamilies && AppState.collapsedFamilies[fam.familyId]);
                  const headerHtml = renderFamilyLedgerHeaderRow(fam, isCollapsed);
                  const childrenHtml = isCollapsed ? '' : fam.students.map((st, sIdx) => {
                    const isLastChild = sIdx === fam.students.length - 1;
                    return renderStudentFeeLedgerRow(st, true, isLastChild);
                  }).join('');
                  return headerHtml + childrenHtml;
                }).join('');
              } else {
              if (AppState.students.length === 0) {
                return `
                  <tr>
                    <td colspan="16" class="py-14 text-center">
                      ${renderSharedEmptyState({
                        icon: 'ledger',
                        title: 'No student accounts in ledger',
                        description: 'Enroll a student from the Student Directory to start generating automated 12-month fee ledgers.',
                        actionText: '+ Add Student',
                        actionFn: 'openAddStudentModal()'
                      })}
                    </td>
                  </tr>
                `;
              }
              if (filtered.length === 0) {
                return `
                  <tr>
                    <td colspan="16" class="py-12 text-center text-[#7A8684]">
                      No student records match the selected filter.
                    </td>
                  </tr>
                `;
              }
                return filtered.map(student => renderStudentFeeLedgerRow(student, false)).join('');
              }
            })()}
          </tbody>
        </table>
      </div>

      <!-- Mobile: Stacked Responsive Cards View (Requirement 2, 3, 4, 5) -->
      <div class="block md:hidden space-y-3.5 w-full">
        ${renderMobileFeeLedgerContent(filtered, isFamilyGrouped)}
      </div>

    </div>
  `;
}

function setFeeFilter(filter) {
  AppState.selectedFilter = filter;
  closeFeeFilterDropdown();
  renderApp();
}

function toggleGroupByFamily() {
  AppState.groupByFamily = !AppState.groupByFamily;
  if (!AppState.groupByFamily && AppState.selectedFilter === 'family') {
    AppState.selectedFilter = 'all';
  }
  closeFeeFilterDropdown();
  renderApp();
}

function toggleFamilyCollapse(familyId, event) {
  if (event) event.stopPropagation();
  if (!AppState.collapsedFamilies) AppState.collapsedFamilies = {};
  AppState.collapsedFamilies[familyId] = !AppState.collapsedFamilies[familyId];
  renderApp();
}

function setCurrencyFilter(curr) {
  AppState.selectedCurrency = curr;
  closeFeeFilterDropdown();
  renderApp();
}

const debouncedApplyFeeSearch = debounce((q, isMobileActive, cursorPos) => {
  AppState.searchQuery = q;
  renderApp();
  const refreshedInput = document.getElementById(isMobileActive ? 'fee-matrix-mobile-search-input' : 'fee-matrix-search-input');
  if (refreshedInput && cursorPos !== null) {
    refreshedInput.focus();
    refreshedInput.setSelectionRange(cursorPos, cursorPos);
  }
}, 200);

function setSearchQuery(q) {
  const desktopInput = document.getElementById('fee-matrix-search-input');
  const mobileInput = document.getElementById('fee-matrix-mobile-search-input');
  const isMobileActive = mobileInput && document.activeElement === mobileInput;
  const activeInput = isMobileActive ? mobileInput : desktopInput;
  const cursorPos = activeInput ? activeInput.selectionStart : null;
  debouncedApplyFeeSearch(q, isMobileActive, cursorPos);
}
window.setSearchQuery = setSearchQuery;

// ==========================================
// MOBILE 12-MONTH FEE LEDGER (STRIPE AESTHETIC)
// ==========================================

function renderMobileFeeLedgerContent(filtered, isFamilyGrouped) {
  if (!AppState.students || AppState.students.length === 0) {
    return `
      <div class="p-8 text-center bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4]">
        <div class="w-12 h-12 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mx-auto mb-3">
          <svg class="w-6 h-6 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"/></svg>
        </div>
        <p class="text-xs font-bold text-[#141F1E]">No active students found.</p>
        <p class="text-[11px] text-[#7A8684] mt-1 mb-4">Enroll your first student in the student directory to activate the fee ledger.</p>
        <button onclick="setNavTab('students')" class="w-full py-2.5 text-xs font-bold rounded-xl bg-[#0E4D45] text-white hover:bg-[#14534B] shadow-sm flex items-center justify-center gap-1.5 cursor-pointer">
          <span>Go to Student Directory →</span>
        </button>
      </div>
    `;
  }

  if (filtered.length === 0) {
    return `
      <div class="p-8 text-center bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4]">
        <p class="text-xs font-bold text-[#141F1E]">No students match your filter</p>
        <p class="text-[11px] text-[#7A8684] mt-1 mb-3">Try adjusting your search query or payment status filter.</p>
        <button onclick="resetFeeFilters()" class="px-4 py-2 text-xs font-semibold rounded-xl bg-white border border-[#ECEAE4] text-[#0E4D45] hover:bg-[#E8EFEE] transition-colors cursor-pointer">
          Clear All Filters
        </button>
      </div>
    `;
  }

  if (isFamilyGrouped) {
    const famMap = {};
    filtered.forEach(s => {
      const famId = s.familyId || s.familyTag || 'FAM-101';
      if (!famMap[famId]) {
        famMap[famId] = {
          familyId: famId,
          guardianName: s.guardianName || 'Guardian',
          currency: s.currency || '$',
          students: [],
          totalMonthlyFee: 0,
          totalDue: 0
        };
      }
      famMap[famId].students.push(s);
      famMap[famId].totalMonthlyFee += s.monthlyFee || 0;
      famMap[famId].totalDue += getStudentBalanceDue(s);
    });

    const familyList = Object.values(famMap);
    if (familyList.length === 0) {
      return `
        <div class="p-8 text-center bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4]">
          <p class="text-xs text-[#7A8684]">No family records match the selected filter.</p>
        </div>
      `;
    }
    return familyList.map(fam => renderMobileFamilyLedgerGroup(fam)).join('');
  }

  return filtered.map(student => renderMobileStudentFeeCard(student, false)).join('');
}

function renderMobileStudentFeeCard(student, isChildOfFamily = false) {
  const balanceDue = getStudentBalanceDue(student);

  return `
    <div class="bg-white rounded-2xl border border-[#ECEAE4] p-4 shadow-2xs hover:shadow-sm transition-all overflow-hidden max-w-full w-full ${isChildOfFamily ? 'border-l-4 border-l-[#0E4D45]' : ''}">
      
      <!-- 1. Card Header: Avatar, Name, ID, Monthly Fee, Status Badge -->
      <div class="flex items-start justify-between gap-2 pb-3 border-b border-[#ECEAE4]/80">
        
        <!-- Left: Avatar + Student Meta -->
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <img 
            src="${student.avatar ? (student.avatar.includes('ui-avatars.com') ? getAvatarUrl(`${student.firstName} ${student.lastName || ''}`) : student.avatar) : getAvatarUrl(`${student.firstName} ${student.lastName || ''}`)}" 
            alt="${student.firstName}" 
            class="w-10 h-10 rounded-full object-cover shrink-0 border border-[#ECEAE4]" 
            onerror="this.onerror=null; this.src='${getAvatarUrl(`${student.firstName} ${student.lastName || ''}`)}';" 
          />
          <div class="min-w-0 flex-1">
            <div class="font-bold text-sm text-[#141F1E] truncate">
              ${student.firstName} ${student.lastName || ''}
            </div>
            <div class="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span class="text-[10px] text-gray-500 font-mono font-medium">ID: ${student.id}</span>
              ${(student.familyId || student.familyTag) ? `
                <span class="text-gray-300">·</span>
                <span class="text-[9px] px-1.5 py-0.2 rounded bg-gray-100 text-gray-600 font-medium">${student.familyId || student.familyTag}</span>
              ` : ''}
              <span class="text-gray-300">·</span>
              <span class="truncate max-w-[100px] text-gray-500">${student.course || 'Quran'}</span>
            </div>
          </div>
        </div>

        <!-- Right: Monthly Fee & Status Badge -->
        <div class="text-right shrink-0">
          <div class="font-bold text-sm text-[#141F1E]">
            ${studentFeePKRHtml(student)}<span class="text-[10px] text-gray-400 font-normal">/mo</span>
          </div>
          <div class="mt-1">
            ${renderStudentLedgerStatusPill(student)}
          </div>
        </div>

      </div>

      <!-- 2. Compact 12-Month Visualization (grid grid-cols-4 gap-2) with colored indicator dots -->
      <div class="pt-3 pb-2">
        <div class="flex items-center justify-between text-[11px] text-[#7A8684] mb-2 font-medium">
          <span class="text-[10px] uppercase font-bold tracking-wider text-gray-400">12-Month Status (${CURRENT_YEAR})</span>
          <span class="text-[10px] font-semibold ${balanceDue > 0 ? 'text-red-600' : 'text-emerald-600'}">
            ${balanceDue > 0 ? studentDuePKRHtml(student, balanceDue) : 'Clear ✓'}
          </span>
        </div>

        <!-- 12 Months as a compact wrap-around grid (grid grid-cols-4 gap-2) -->
        <div class="grid grid-cols-4 gap-2 w-full">
          ${student.months.map((m, idx) => {
            const isCurrentMonth = idx === CURRENT_MONTH_INDEX;
            let dotIndicator = 'bg-gray-300';
            let pillBg = 'bg-[#F8F6F1]/70 text-gray-600 border-[#ECEAE4]';
            let amountText = '—';

            if (m.status === 'paid') {
              dotIndicator = 'bg-emerald-500';
              pillBg = 'bg-emerald-50/70 text-emerald-900 border-emerald-200/80';
              amountText = `${student.currency || '$'}${m.amountPaid}`;
            } else if (m.status === 'partial') {
              dotIndicator = 'bg-amber-500';
              pillBg = 'bg-amber-50/70 text-amber-900 border-amber-200/80';
              amountText = `${student.currency || '$'}${m.amountPaid}`;
            } else if (m.status === 'advance') {
              dotIndicator = 'bg-teal-500';
              pillBg = 'bg-teal-50/70 text-teal-900 border-teal-200/80';
              amountText = `${student.currency || '$'}${m.amountPaid}`;
            } else if (m.status === 'defaulter') {
              dotIndicator = 'bg-red-500';
              pillBg = 'bg-red-50/70 text-red-900 border-red-200/80';
              amountText = `${student.currency || '$'}${m.feeDue || student.monthlyFee}`;
            }

            const mobileStatusMap = { paid: 'Paid', partial: 'Partial', advance: 'Advance', defaulter: 'Overdue', upcoming: 'Upcoming', not_enrolled: 'Not Enrolled' };
            const cleanMobileStatus = mobileStatusMap[m.status] || 'Not Enrolled';
            let mobileTitle = `${m.month} ${CURRENT_YEAR}: ${cleanMobileStatus} (${amountText})`;
            if (m.status === 'paid') {
              const rcpt = m.receiptNo || '';
              const pDate = m.paymentDate || 'Nov 24, 2026';
              const pMethod = m.paymentMethod || 'Online Card (Stripe)';
              if (rcpt) {
                mobileTitle += ` • Receipt #${rcpt} (${pDate}) via ${pMethod}`;
              }
            }

            return `
              <button 
                type="button"
                onclick="openMonthDetailModal('${student.id}', ${idx})" 
                class="flex items-center justify-center gap-1.5 py-1.5 px-1.5 rounded-xl border text-center transition-all hover:shadow-2xs active:scale-95 cursor-pointer ${pillBg} ${isCurrentMonth ? 'ring-1.5 ring-[#0E4D45] font-bold' : ''}"
                title="${mobileTitle}"
              >
                <span class="w-2 h-2 rounded-full ${dotIndicator} shrink-0"></span>
                <span class="text-[11px] font-semibold leading-none truncate">${m.month}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <!-- 3. Bottom Action Row: Thumb-Friendly Touch Targets -->
      <div class="flex items-center gap-2 pt-2.5 mt-1 border-t border-[#ECEAE4]/80">
        <button 
          onclick="openReceiveFeeModal('${student.id}')" 
          class="flex-1 py-2 px-2 text-xs font-bold rounded-xl bg-[#0E4D45] hover:bg-[#14534B] text-white flex items-center justify-center gap-1 shadow-2xs transition-colors cursor-pointer"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
          <span>Pay Fee</span>
        </button>

        <button 
          onclick="openWhatsAppFeeReminder('${student.id}')" 
          class="py-2 px-3 text-xs font-semibold rounded-xl bg-[#25D366]/10 hover:bg-[#25D366]/20 text-[#128C7E] flex items-center justify-center gap-1 transition-colors cursor-pointer"
          title="Send WhatsApp Reminder"
        >
          <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
          <span class="text-[11px] font-semibold">WhatsApp</span>
        </button>

        <button 
          onclick="openMonthDetailModal('${student.id}', ${CURRENT_MONTH_INDEX})" 
          class="py-2 px-3 text-xs font-semibold rounded-xl bg-[#F8F6F1] hover:bg-[#E8EFEE] text-[#141F1E] border border-[#ECEAE4] transition-colors cursor-pointer"
          title="View Statement & Details"
        >
          Details
        </button>
      </div>

    </div>
  `;
}

function renderMobileFamilyLedgerGroup(fam) {
  const isCollapsed = Boolean(AppState.collapsedFamilies && AppState.collapsedFamilies[fam.familyId]);

  return `
    <div class="bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4] p-4 shadow-2xs space-y-3">
      <!-- Family Summary Header -->
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-md bg-[#0E4D45] text-white text-[10px] font-bold">${fam.familyId}</span>
            <span class="font-bold text-sm text-[#141F1E]">${fam.guardianName}</span>
          </div>
          <p class="text-[11px] text-gray-500 mt-0.5">${fam.students.length} Enrolled Sibling${fam.students.length > 1 ? 's' : ''} · ${fam.currency}${fam.totalMonthlyFee}/mo</p>
        </div>
        <div class="text-right">
          <span class="text-[10px] text-gray-400 font-medium block">Total Balance</span>
          <span class="text-xs font-bold ${fam.totalDue > 0 ? 'text-red-600' : 'text-emerald-600'}">
            ${fam.totalDue > 0 ? familyDuePKRHtml(fam) : 'Clear ✓'}
          </span>
        </div>
      </div>

      <!-- Family Action Buttons -->
      <div class="flex items-center gap-2">
        <button 
          onclick="openReceiveFeeModal('${fam.familyId}')" 
          class="flex-1 py-1.5 px-3 rounded-xl bg-white border border-[#ECEAE4] text-xs font-semibold text-[#0E4D45] hover:bg-[#E8EFEE] transition-colors shadow-2xs cursor-pointer"
        >
          Pay Family Invoice
        </button>
        <button 
          onclick="toggleFamilyCollapse('${fam.familyId}')" 
          class="py-1.5 px-3 rounded-xl bg-white border border-[#ECEAE4] text-xs font-semibold text-[#7A8684] hover:text-[#141F1E] transition-colors shadow-2xs cursor-pointer"
        >
          ${isCollapsed ? 'Show Students ▼' : 'Hide Students ▲'}
        </button>
      </div>

      <!-- Sibling Student Cards -->
      ${!isCollapsed ? `
        <div class="space-y-2.5 pt-1">
          ${fam.students.map(st => renderMobileStudentFeeCard(st, true)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function toggleFeeFilterDropdown(event) {
  if (event) event.stopPropagation();
  AppState.isFeeFilterOpen = !AppState.isFeeFilterOpen;
  const menu = document.getElementById('fee-filter-dropdown-menu');
  if (menu) {
    if (AppState.isFeeFilterOpen) menu.classList.remove('hidden');
    else menu.classList.add('hidden');
  }
}

function closeFeeFilterDropdown() {
  AppState.isFeeFilterOpen = false;
  const menu = document.getElementById('fee-filter-dropdown-menu');
  if (menu && !menu.classList.contains('hidden')) {
    menu.classList.add('hidden');
  }
}

window.toggleFeeFilterDropdown = toggleFeeFilterDropdown;
window.closeFeeFilterDropdown = closeFeeFilterDropdown;

document.addEventListener('click', (e) => {
  const container = document.getElementById('desktop-fee-filter-container');
  const menu = document.getElementById('fee-filter-dropdown-menu');
  if (container && menu && !container.contains(e.target) && !menu.contains(e.target)) {
    closeFeeFilterDropdown();
  }
});

function openFeeFilterBottomSheet() {
  const sheet = document.getElementById('fee-filter-bottom-sheet');
  if (!sheet) return;
  updateFeeFilterBottomSheetUI();
  sheet.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeFeeFilterBottomSheet() {
  const sheet = document.getElementById('fee-filter-bottom-sheet');
  if (sheet) {
    sheet.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function handleFeeFilterBackdropClick(event) {
  if (event.target.id === 'fee-filter-bottom-sheet') {
    closeFeeFilterBottomSheet();
  }
}

function updateFeeFilterBottomSheetUI() {
  const statusContainer = document.getElementById('bottom-sheet-status-filters');
  const familyToggle = document.getElementById('bottom-sheet-family-toggle');
  const currencyContainer = document.getElementById('bottom-sheet-currency-filters');
  const monthLabel = document.getElementById('bottom-sheet-month-label');

  if (monthLabel) {
    monthLabel.textContent = `${MONTHS_LIST[CURRENT_MONTH_INDEX]} ${CURRENT_YEAR}`;
  }

  if (statusContainer) {
    const statuses = [
      { id: 'all', label: `All (${AppState.students ? AppState.students.length : 0})` },
      { id: 'paid', label: 'Paid' },
      { id: 'partial', label: 'Partial' },
      { id: 'advance', label: 'Advance' },
      { id: 'defaulter', label: 'Overdue' }
    ];
    statusContainer.innerHTML = statuses.map((s, idx) => {
      const active = AppState.selectedFilter === s.id;
      return `
        <button 
          type="button" 
          onclick="setFeeFilter('${s.id}'); updateFeeFilterBottomSheetUI();" 
          class="${idx < 3 ? 'col-span-2' : 'col-span-3'} py-2 px-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border text-center whitespace-nowrap ${active ? 'bg-[#0E4D45] text-white border-[#0E4D45] shadow-xs' : 'bg-white text-gray-700 border-[#ECEAE4] hover:bg-[#F8F6F1]'}"
        >
          ${s.label}
        </button>
      `;
    }).join('');
  }

  if (familyToggle) {
    const isGrouped = Boolean(AppState.groupByFamily || AppState.selectedFilter === 'family');
    familyToggle.setAttribute('aria-checked', isGrouped ? 'true' : 'false');
    familyToggle.innerHTML = `
      <div class="transition-colors relative" style="width: 28px; height: 16px; border-radius: 9999px; background-color: ${isGrouped ? '#0E4D45' : '#CBD5E1'}; position: relative;">
        <div class="transition-all shadow-xs" style="width: 12px; height: 12px; border-radius: 9999px; background-color: #FFFFFF; position: absolute; top: 2px; left: ${isGrouped ? '14px' : '2px'};"></div>
      </div>
      <span class="text-xs font-bold ${isGrouped ? 'text-[#0E4D45]' : 'text-gray-400'}">${isGrouped ? 'ON' : 'OFF'}</span>
    `;
  }

  if (currencyContainer) {
    const currencies = [{ id: 'all', label: 'All' }].concat(
      ledgerCurrencyFilterCodes().map(c => ({ id: c, label: getCurrencySymbol(c) + ' ' + c }))
    );
    currencyContainer.innerHTML = currencies.map(c => {
      const active = AppState.selectedCurrency === c.id;
      return `
        <button 
          type="button" 
          onclick="setCurrencyFilter('${c.id}'); updateFeeFilterBottomSheetUI();" 
          class="py-2 px-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border text-center ${active ? 'bg-[#0E4D45] text-white border-[#0E4D45] shadow-xs' : 'bg-white text-gray-700 border-[#ECEAE4] hover:bg-[#F8F6F1]'}"
        >
          ${c.label}
        </button>
      `;
    }).join('');
  }
}

function resetFeeFilters() {
  AppState.selectedFilter = 'all';
  AppState.selectedCurrency = 'all';
  AppState.groupByFamily = true;
  AppState.searchQuery = '';
  closeFeeFilterDropdown();
  renderApp();
}

// ==========================================
// 7. MODULE 1: FULL PII DIRECTORY (ADMIN ONLY) - ULTRA-CLEAN SINGLE-LINE REDESIGN
// ==========================================

function getCompactScheduleSummary(student) {
  if (!student.weeklySchedule) {
    return student.classSchedule ? student.classSchedule.split('•')[0].trim() : 'Schedule Pending';
  }
  const sched = student.weeklySchedule;
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayLabels = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const activeDays = days.filter(d => sched[d] && sched[d].active);
  
  if (activeDays.length === 0) return 'No active schedule';
  
  const firstTime = sched[activeDays[0]]?.time || '';
  const startTime = firstTime.split('-')[0].trim(); // e.g. "11:00 AM"

  if (activeDays.length === 4 && activeDays.slice(0, 4).join(',') === 'mon,tue,wed,thu') {
    return `Mon-Thu ${startTime}`;
  }
  if (activeDays.length === 5 && activeDays.slice(0, 5).join(',') === 'mon,tue,wed,thu,fri') {
    return `Daily (Mon-Fri) ${startTime}`;
  }
  if (activeDays.length === 2 && activeDays.join(',') === 'sat,sun') {
    return `Weekend ${startTime}`;
  }
  if (activeDays.length <= 3) {
    const dayStr = activeDays.map(d => dayLabels[d]).join(', ');
    return `${dayStr} ${startTime}`;
  }
  return `${activeDays.length}d/wk • ${startTime}`;
}

function renderStudentStatusPill(status) {
  const normStatus = (status || 'Active').trim();
  let bg = 'bg-[#E0F2F1]';
  let text = 'text-[#0E4D45]';
  let dot = 'bg-[#0E4D45]';
  let label = 'Active';

  if (normStatus === 'Active') {
    bg = 'bg-[#E0F2F1]';
    text = 'text-[#0E4D45]';
    dot = 'bg-[#0E4D45]';
    label = 'Active';
  } else if (normStatus === 'On Trial' || normStatus === 'Trial') {
    bg = 'bg-[#FEF3C7]';
    text = 'text-[#92400E]';
    dot = 'bg-[#D97706]';
    label = 'On Trial';
  } else if (normStatus === 'On Leave' || normStatus === 'Paused') {
    bg = 'bg-[#E0F2FE]';
    text = 'text-[#0369A1]';
    dot = 'bg-[#0284C7]';
    label = 'On Leave';
  } else if (normStatus === 'Inactive' || normStatus === 'Dropped') {
    bg = 'bg-[#FEE2E2]';
    text = 'text-[#991B1B]';
    dot = 'bg-[#DC2626]';
    label = 'Inactive';
  }

  return `
    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold ${bg} ${text} tracking-wide whitespace-nowrap shadow-2xs">
      <span class="w-1.5 h-1.5 rounded-full ${dot}"></span>
      <span>${label}</span>
    </span>
  `;
}

/**
 * Filter students across Directory and Fee Ledger by family tag
 */
function filterByFamilyTag(familyTag, event) {
  if (event) event.stopPropagation();
  if (!familyTag) return;

  if (AppState.activeNav === 'students') {
    if (AppState.studentDirectorySearchQuery === familyTag) {
      AppState.studentDirectorySearchQuery = '';
      renderApp();
      showToastNotification(`Cleared Family filter`);
    } else {
      AppState.studentDirectorySearchQuery = familyTag;
      AppState.studentDirectoryStatusFilter = 'all';
      AppState.studentDirectoryCountryFilter = 'all';
      renderApp();
      showToastNotification(`✓ Filtered Student Directory by Family: ${familyTag}`);
    }
  } else if (AppState.activeNav === 'fee-matrix') {
    if (AppState.searchQuery === familyTag) {
      AppState.searchQuery = '';
      renderApp();
      showToastNotification(`Cleared Family filter`);
    } else {
      AppState.searchQuery = familyTag;
      AppState.selectedFilter = 'all';
      renderApp();
      showToastNotification(`✓ Filtered Fee Ledger by Family: ${familyTag}`);
    }
  } else {
    AppState.activeNav = 'fee-matrix';
    AppState.searchQuery = familyTag;
    AppState.selectedFilter = 'all';
    renderApp();
    showToastNotification(`✓ Opened Fee Ledger for Family: ${familyTag}`);
  }
}

function toggleLedgerRowActionMenu(studentId, event) {
  if (event) event.stopPropagation();
  AppState.activeLedgerActionMenuId = (AppState.activeLedgerActionMenuId === studentId) ? null : studentId;
  renderApp();
}

function closeLedgerRowActionMenu() {
  if (AppState.activeLedgerActionMenuId) {
    AppState.activeLedgerActionMenuId = null;
    renderApp();
  }
}

function getFilteredStudentsForDirectory() {
  let list = AppState.students;

  // Status Filter
  if (AppState.studentDirectoryStatusFilter && AppState.studentDirectoryStatusFilter !== 'all') {
    list = list.filter(s => (s.academicStatus || 'Active') === AppState.studentDirectoryStatusFilter);
  }

  // Country Filter
  if (AppState.studentDirectoryCountryFilter && AppState.studentDirectoryCountryFilter !== 'all') {
    list = list.filter(s => s.country === AppState.studentDirectoryCountryFilter);
  }

  // Course Filter (Advanced Filter)
  if (AppState.studentDirectoryCourseFilter && AppState.studentDirectoryCourseFilter !== 'all') {
    list = list.filter(s => (s.course || '').toLowerCase() === AppState.studentDirectoryCourseFilter.toLowerCase());
  }

  // Teacher Filter (Advanced Filter)
  if (AppState.studentDirectoryTeacherFilter && AppState.studentDirectoryTeacherFilter !== 'all') {
    list = list.filter(s => {
      const tid = (s.teacherId || '').toLowerCase();
      const tname = (s.teacherName || s.assignedTeacher || '').toLowerCase();
      const target = AppState.studentDirectoryTeacherFilter.toLowerCase();
      return tid === target || tname === target;
    });
  }

  // Fee Status Filter (Advanced Filter)
  if (AppState.studentDirectoryFeeFilter && AppState.studentDirectoryFeeFilter !== 'all') {
    list = list.filter(s => {
      const feeStatus = typeof getStudentFeeStatus === 'function' ? getStudentFeeStatus(s) : null;
      return feeStatus && feeStatus.code === AppState.studentDirectoryFeeFilter;
    });
  }

  // Search Filter
  if (AppState.studentDirectorySearchQuery && AppState.studentDirectorySearchQuery.trim() !== '') {
    const q = AppState.studentDirectorySearchQuery.trim().toLowerCase();
    list = list.filter(s => {
      const teacher = (AppState.teachers || []).find(t => 
        t.id === s.teacherId || 
        (t.id && s.teacherId && t.id.toLowerCase() === s.teacherId.toLowerCase()) ||
        t.name === s.teacherName ||
        t.name === s.assignedTeacher ||
        (t.name && s.teacherName && t.name.toLowerCase() === s.teacherName.toLowerCase()) ||
        (t.name && s.assignedTeacher && t.name.toLowerCase() === s.assignedTeacher.toLowerCase())
      );
      const fullName = `${s.firstName} ${s.lastName || ''}`.toLowerCase();
      const id = (s.id || '').toLowerCase();
      const family = (s.familyId || s.familyTag || '').toLowerCase();
      const phone = (s.phone || '').toLowerCase();
      const course = (s.course || '').toLowerCase();
      const teacherName = (teacher ? teacher.name : (s.teacherName || s.assignedTeacher || '')).toLowerCase();
      const guardian = (s.guardianName || '').toLowerCase();
      const country = (s.country || '').toLowerCase();
      return fullName.includes(q) || id.includes(q) || family.includes(q) || phone.includes(q) || course.includes(q) || teacherName.includes(q) || guardian.includes(q) || country.includes(q);
    });
  }

  return list;
}

function renderStudentDirectoryRows(students) {
  if (!AppState.students || AppState.students.length === 0) {
    return `
      <tr>
        <td colspan="9" class="py-16 text-center bg-[#F8F6F1]/50">
          <div class="max-w-md mx-auto flex flex-col items-center">
            <div class="w-12 h-12 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mb-3">
              <svg class="w-6 h-6 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"/></svg>
            </div>
            <p class="text-xs font-bold text-[#141F1E]">No active students found.</p>
            <p class="text-[11px] text-[#7A8684] mt-1">Use the "+ Add Student" button above to enroll your first student into the directory.</p>
          </div>
        </td>
      </tr>
    `;
  }

  if (!students || students.length === 0) {
    return `
      <tr>
        <td colspan="9" class="py-12 text-center text-[#7A8684]">
          <div class="flex flex-col items-center justify-center">
            <div class="w-10 h-10 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mb-2.5">
              <svg class="w-5 h-5 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
            <p class="font-semibold text-sm text-[#141F1E]">No students match your filter criteria</p>
            <p class="text-xs text-[#7A8684] mt-1">Try resetting the status filter or clearing your search query.</p>
            <button onclick="resetStudentDirectoryFilters()" class="mt-3 px-4 py-1.5 rounded-lg bg-[#0E4D45] text-white text-xs font-semibold hover:bg-[#14534B] transition-colors cursor-pointer">
              Reset All Filters
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  return students.map((s, sIdx) => {
    let teacher = null;
    const isLowerRow = sIdx >= Math.max(0, students.length - 2);
    const rawTid = String(s.teacherId || '').trim();
    const rawTname = String(s.teacherName || '').trim();
    const rawAssigned = String(s.assignedTeacher || '').trim();
    const isUnassignedRecord = !rawTid || rawTid.toLowerCase() === 'unassigned' || rawTid.toLowerCase() === 't-unassigned' ||
                               rawTname.toLowerCase() === 'unassigned' || rawAssigned.toLowerCase() === 'unassigned' || rawAssigned.toLowerCase() === 'teacher unassigned';

    if (!isUnassignedRecord) {
      teacher = (AppState.teachers || []).find(t => {
        const tid = String(t.id).trim().toLowerCase();
        const tname = String(t.name).trim().toLowerCase();
        return (rawTid && (tid === rawTid.toLowerCase() || tname === rawTid.toLowerCase())) ||
               (rawTname && (tname === rawTname.toLowerCase() || tid === rawTname.toLowerCase())) ||
               (rawAssigned && (tname === rawAssigned.toLowerCase() || tid === rawAssigned.toLowerCase()));
      });
    }
    const teacherDisplayName = teacher ? teacher.name : 'Unassigned';
    const currentMonthObj = Array.isArray(s.months) ? s.months[CURRENT_MONTH_INDEX] : null;
    const isDefaulter = (currentMonthObj && currentMonthObj.status === 'defaulter') || 
                        (Array.isArray(s.months) && s.months.some(m => m.status === 'defaulter'));
    const scheduleSlots = getStudentScheduleSlots(s);
    const isMenuOpen = AppState.activeStudentActionMenuId === s.id;
    const isSchedOpen = AppState.activeStudentSchedulePopoverId === s.id;
    const isContactOpen = AppState.activeStudentContactPopoverId === s.id;

    return `
      <tr class="hover:bg-[#F8F6F1]/50 transition-colors border-b border-[#F1EFEA]">
        <!-- 0. Selection Checkbox -->
        <td class="py-3.5 px-2.5 w-8" data-label="Select">
          <input 
            type="checkbox" 
            class="student-row-checkbox rounded border-[#ECEAE4] text-[#0E4D45] focus:ring-[#0E4D45] cursor-pointer" 
            value="${s.id}" 
            ${AppState.selectedStudentIds && AppState.selectedStudentIds.has(s.id) ? 'checked' : ''} 
            onchange="toggleSelectStudent('${s.id}', this.checked)"
          />
        </td>

        <!-- 1. Student Name (Avatar + Full Name + Subtle QA-1008 Badge + Family Tag Pill) -->
        <td class="py-3.5 px-2.5" data-label="Student">
          <div class="flex items-center gap-1.5 whitespace-nowrap">
            <img 
              src="${s.avatar ? (s.avatar.includes('ui-avatars.com') ? getAvatarUrl(`${s.firstName} ${s.lastName || ''}`) : s.avatar) : getAvatarUrl(`${s.firstName} ${s.lastName || ''}`)}" 
              alt="${s.firstName}" 
              class="w-8 h-8 rounded-full object-cover shrink-0 ring-1 ring-[#ECEAE4]" 
              onerror="this.onerror=null; this.src='${getAvatarUrl(`${s.firstName} ${s.lastName || ''}`)}';" 
            />
            <span class="font-semibold text-xs text-[#141F1E]">${s.firstName} ${s.lastName}</span>
            <span class="px-1.5 py-0.5 rounded-full bg-[#F1EFEA] text-[10px] font-bold text-[#7A8684]">${s.id}</span>
            <button type="button" onclick="filterByFamilyTag('${s.familyId || s.familyTag}', event)" 
              class="px-2 py-0.5 rounded-full bg-[#E8EFEE] hover:bg-[#0E4D45] hover:text-white text-[10px] font-bold text-[#0E4D45] transition-all cursor-pointer shadow-2xs" 
              title="Filter by family group ${s.familyId || s.familyTag}">
              ${s.familyId || s.familyTag}
            </button>
          </div>
        </td>

        <!-- 2. Course Track (Single-Line Text with clean max width) -->
        <td class="py-3.5 px-2.5" data-label="Course Track">
          <span class="text-xs text-[#141F1E] font-medium whitespace-normal" title="${s.course || 'Quran Studies'}">
            ${s.course || 'Quran Studies'}
          </span>
        </td>

        <!-- 3. Assigned Teacher (Avatar + Full Name on a single line) -->
        <td class="py-3.5 px-2.5" data-label="Teacher">
          <div class="flex items-center gap-2 whitespace-nowrap">
            <img 
              src="${teacher?.avatar ? (teacher.avatar.includes('ui-avatars.com') ? getAvatarUrl(teacherDisplayName) : teacher.avatar) : getAvatarUrl(teacherDisplayName)}" 
              alt="${teacherDisplayName}" 
              class="w-7 h-7 rounded-full object-cover shrink-0 ring-1 ring-[#ECEAE4]" 
              onerror="this.onerror=null; this.src='${getAvatarUrl(teacherDisplayName)}';" 
            />
            <span class="text-xs font-semibold text-[#141F1E]">${teacherDisplayName}</span>
          </div>
        </td>

        <!-- 4. Guardian Contact (Interactive Dropdown Pill & Streamlined 2-Item Popover) -->
        <td class="py-3.5 px-2.5 whitespace-nowrap" data-label="Guardian Contact">
          <div class="relative inline-block student-contact-popover-container">
            <button 
              onclick="toggleStudentContactPopover('${s.id}', event)" 
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer shadow-2xs ${
                isContactOpen 
                  ? 'bg-[#0E4D45] text-white shadow-xs' 
                  : isDefaulter 
                    ? 'bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA]' 
                    : 'bg-[#F8F6F1] hover:bg-[#E8EFEE] text-[#0E4D45] border border-[#ECEAE4]'
              }"
              title="Click to view contact info for ${s.firstName}"
            >
              <svg class="w-3 h-3 ${isContactOpen ? 'text-white' : isDefaulter ? 'text-[#B91C1C]' : 'text-[#0E4D45]'}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
              </svg>
              <span>${s.phone || 'Contact'} ▾</span>
            </button>

            ${isContactOpen ? `
              <div class="absolute left-0 top-9 rounded-2xl shadow-2xl border border-[#ECEAE4] p-4 w-72 bg-white z-40 text-left animate-in fade-in zoom-in-95 duration-150">
                <!-- Popover Header -->
                <div class="flex items-center justify-between pb-2.5 mb-3 border-b border-[#F1EFEA]">
                  <div>
                    <h4 class="text-xs font-bold text-[#141F1E] flex items-center gap-1.5">
                      <span>${s.guardianName || 'Parent / Guardian'}</span>
                    </h4>
                    <p class="text-[10px] text-[#7A8684] mt-0.5">${s.firstName}'s Family (${s.familyId || 'FAM-101'})</p>
                  </div>
                  <span class="px-2 py-0.5 rounded-full bg-[#E0F2F1] text-[#0E4D45] text-[10px] font-bold">
                    ${s.country || 'Global'}
                  </span>
                </div>

                <!-- Strictly 2 Items: WhatsApp / Phone & Email Address -->
                <div class="space-y-2.5 text-xs">
                  <!-- Item 1: WhatsApp / Phone -->
                  <div class="p-2.5 rounded-xl bg-[#F8F6F1] border border-[#E5E7EB] flex items-center justify-between gap-2.5">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <div class="w-8 h-8 rounded-full bg-[#25D366]/15 text-[#128C7E] flex items-center justify-center shrink-0">
                        <svg class="w-4 h-4 fill-[#25D366]" viewBox="0 0 24 24">
                          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                        </svg>
                      </div>
                      <div class="min-w-0">
                        <span class="text-[10px] text-[#7A8684] block font-medium">WhatsApp / Phone</span>
                        <span class="text-xs font-bold text-[#141F1E] truncate block">${s.phone}</span>
                      </div>
                    </div>
                    <a 
                      href="https://wa.me/${(s.whatsapp || s.phone).replace(/[^0-9]/g, '')}" 
                      target="_blank" 
                      class="px-2.5 py-1.5 rounded-full bg-[#25D366] hover:bg-[#128C7E] text-white text-[11px] font-bold transition-all shadow-2xs flex items-center gap-1 shrink-0"
                      title="Open WhatsApp Chat"
                    >
                      <span>Chat</span>
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                    </a>
                  </div>

                  <!-- Item 2: Email Address -->
                  <div class="p-2.5 rounded-xl bg-[#F8F6F1] border border-[#E5E7EB] flex items-center justify-between gap-2.5">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <div class="w-8 h-8 rounded-full bg-[#E0F2FE] text-[#0284C7] flex items-center justify-center shrink-0">
                        <svg class="w-4 h-4 text-[#0284C7]" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                          <polyline points="22,6 12,13 2,6"></polyline>
                        </svg>
                      </div>
                      <div class="min-w-0">
                        <span class="text-[10px] text-[#7A8684] block font-medium">Email Address</span>
                        <span class="text-xs font-medium text-[#141F1E] truncate block" title="${s.email || 'parent@guardian.com'}">
                          ${s.email || 'parent@guardian.com'}
                        </span>
                      </div>
                    </div>
                    <a 
                      href="mailto:${s.email || 'parent@guardian.com'}" 
                      class="px-2.5 py-1.5 rounded-full bg-white hover:bg-[#E0F2FE] text-[#0284C7] border border-[#CBD5E1] text-[11px] font-bold transition-colors shrink-0"
                      title="Send Email"
                    >
                      <span>Email</span>
                    </a>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
        </td>

        <!-- 5. Agreed Fee (Single-line clean agreed monthly fee) -->
        <td class="py-3.5 px-2.5 whitespace-nowrap" data-label="Agreed Fee">
          <span class="text-xs text-[#141F1E] font-medium">
            <span class="font-bold text-[#0E4D45]">${studentFeePKRHtml(s)}</span><span class="text-[#7A8684] text-[11px]">/mo</span>
          </span>
        </td>

        <!-- 6. Timetable (Interactive Day-by-Day Variable Timetable Pill & View-Only Popover) -->
        <td class="py-3.5 px-2.5 whitespace-nowrap" data-label="Timetable">
          <div class="relative inline-block student-schedule-popover-container">
            <button 
              onclick="toggleStudentSchedulePopover('${s.id}', event)" 
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer shadow-2xs ${
                isSchedOpen 
                  ? 'bg-[#0E4D45] text-white shadow-xs' 
                  : 'bg-[#F8F6F1] hover:bg-[#E8EFEE] text-[#0E4D45] border border-[#ECEAE4]'
              }"
              title="Click to view ${s.firstName}'s day-by-day timetable"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
              <span>${scheduleSlots.length} Days/wk ▾</span>
            </button>

            ${isSchedOpen ? `
              <div class="absolute right-0 top-9 rounded-2xl shadow-2xl border border-[#ECEAE4] p-3.5 w-76 bg-white z-40 text-left animate-in fade-in zoom-in-95 duration-150">
                <div class="flex items-center justify-between pb-2 mb-2 border-b border-[#F1EFEA]">
                  <div>
                    <h4 class="text-xs font-bold text-[#141F1E]">${s.firstName}'s Timetable</h4>
                    <p class="text-[10px] text-[#7A8684] font-medium">${s.timezone}</p>
                  </div>
                  <span class="px-2 py-0.5 rounded-full bg-[#E0F2F1] text-[#0E4D45] text-[10px] font-bold">
                    ${scheduleSlots.length} Days/wk
                  </span>
                </div>

                <div class="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                  ${scheduleSlots.map(slot => `
                    <div class="flex items-center justify-between p-2 rounded-xl bg-[#F8F6F1] border border-[#ECEAE4]/80 text-[11px]">
                      <div class="flex items-center gap-1.5">
                        <span class="w-8 py-0.5 text-center font-bold text-[10px] rounded-md bg-[#0E4D45] text-white">${slot.day}</span>
                        <span class="font-bold text-[#141F1E]">${slot.time}</span>
                        <span class="text-[10px] text-[#7A8684]">(${slot.duration})</span>
                      </div>
                      <div class="text-right">
                        <span class="text-[10px] font-bold text-[#0E4D45] bg-white px-2 py-0.5 rounded-full border border-[#CBD5E1]">
                          ${slot.pktTime}
                        </span>
                      </div>
                    </div>
                  `).join('')}
                </div>

                <div class="mt-2.5 pt-2 border-t border-[#F1EFEA] flex items-center justify-between">
                  <span class="text-[10px] text-[#7A8684]">Teacher: <strong class="text-[#141F1E] font-semibold">${teacher ? teacher.name : 'Ustadh'}</strong></span>
                </div>
              </div>
            ` : ''}
          </div>
        </td>

        <!-- 7. Student Status (Soft Pastel Pill Badge) -->
        <td class="py-3.5 px-2.5 whitespace-nowrap" data-label="Status">
          ${renderStudentStatusPill(s.academicStatus)}
        </td>

        <!-- 8. 3-Dots Action Menu Column (Rightmost End, Never Cut Off) -->
        <td class="py-3.5 px-2.5 w-10 text-right relative student-action-menu-container" data-label="Actions">
          <button onclick="toggleStudentActionMenu('${s.id}', event)" class="w-8 h-8 rounded-full flex items-center justify-center text-[#7A8684] hover:text-[#141F1E] hover:bg-[#F8F6F1] transition-all cursor-pointer font-bold leading-none inline-flex" title="Actions for ${s.firstName}">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
          </button>

          ${isMenuOpen ? `
            <div class="absolute right-0 ${isLowerRow ? 'bottom-10' : 'top-11'} rounded-2xl shadow-xl border border-[#ECEAE4] p-1.5 w-48 bg-white z-50 text-left animate-in fade-in zoom-in-95 duration-150">
              <button onclick="closeStudentActionMenu(); openViewWeeklyScheduleModal('${s.id}')" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#141F1E] hover:bg-[#F8F6F1] transition-colors cursor-pointer whitespace-nowrap">
                <svg class="w-4 h-4 text-[#7A8684] shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <span>Full Profile</span>
              </button>
              <button onclick="closeStudentActionMenu(); openReceiveFeeModal('${s.id}')" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#141F1E] hover:bg-[#F8F6F1] transition-colors cursor-pointer whitespace-nowrap">
                <svg class="w-4 h-4 text-[#0E4D45] shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
                <span>Receive Fee</span>
              </button>
              <button onclick="closeStudentActionMenu(); filterByFamilyTag('${s.familyId || s.familyTag}')" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#141F1E] hover:bg-[#F8F6F1] transition-colors cursor-pointer whitespace-nowrap">
                <svg class="w-4 h-4 text-[#7A8684] shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                <span>Filter Family (${s.familyId || s.familyTag})</span>
              </button>
              <button onclick="closeStudentActionMenu(); openEditScheduleModal('${s.id}')" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#141F1E] hover:bg-[#F8F6F1] transition-colors cursor-pointer whitespace-nowrap">
                <svg class="w-4 h-4 text-[#7A8684] shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                <span>Edit Student</span>
              </button>
              <!-- Toggle Status with 3-Option Sub-Menu -->
              <div class="relative group/status" id="status-menu-group-${s.id}">
                <button 
                  type="button" 
                  onclick="toggleStatusSubmenu('${s.id}', event)" 
                  class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-[#141F1E] hover:bg-[#F8F6F1] transition-colors cursor-pointer whitespace-nowrap"
                >
                  <div class="flex items-center gap-2.5">
                    <svg class="w-4 h-4 text-[#7A8684] shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                      <path d="M23 4v6h-6"></path>
                      <path d="M1 20v-6h6"></path>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    <span>Toggle Status</span>
                  </div>
                  <svg class="w-3 h-3 text-[#94A3B8] transition-transform group-hover/status:-translate-x-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
                  </svg>
                </button>

                <!-- Floating 3-Option Sub-Menu to the Left -->
                <div 
                  id="status-submenu-${s.id}" 
                  class="hidden group-hover/status:block absolute right-full ${isLowerRow ? 'bottom-0' : 'top-0'} mr-1.5 w-48 bg-white rounded-2xl shadow-2xl border border-[#ECEAE4] p-1.5 z-50 text-left animate-in fade-in zoom-in-95 duration-100 before:absolute before:right-[-10px] before:top-0 before:w-[15px] before:h-full before:content-['']"
                >
                  <div class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#94A3B8] border-b border-[#F1EFEA] mb-1">
                    Select Status
                  </div>

                  <!-- 1. Active -->
                  <button 
                    onclick="setStudentStatus('${s.id}', 'Active', event)" 
                    class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      (s.academicStatus || 'Active') === 'Active' 
                        ? 'bg-[#E0F2F1] text-[#0E4D45]' 
                        : 'text-[#141F1E] hover:bg-[#F8F6F1]'
                    }"
                  >
                    <span class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full bg-[#10B981] shadow-2xs"></span>
                      <span>Active</span>
                    </span>
                    ${(s.academicStatus || 'Active') === 'Active' ? '<span class="text-[#0E4D45] text-xs font-bold">✓</span>' : ''}
                  </button>

                  <!-- 2. On Trial -->
                  <button 
                    onclick="setStudentStatus('${s.id}', 'On Trial', event)" 
                    class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      s.academicStatus === 'On Trial' 
                        ? 'bg-[#FEF3C7] text-[#92400E]' 
                        : 'text-[#141F1E] hover:bg-[#F8F6F1]'
                    }"
                  >
                    <span class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full bg-[#F59E0B] shadow-2xs"></span>
                      <span>On Trial</span>
                    </span>
                    ${s.academicStatus === 'On Trial' ? '<span class="text-[#92400E] text-xs font-bold">✓</span>' : ''}
                  </button>

                  <!-- 3. On Leave / Inactive -->
                  <button 
                    onclick="setStudentStatus('${s.id}', 'Inactive', event)" 
                    class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      (s.academicStatus === 'Inactive' || s.academicStatus === 'On Leave') 
                        ? 'bg-[#FEE2E2] text-[#991B1B]' 
                        : 'text-[#141F1E] hover:bg-[#F8F6F1]'
                    }"
                  >
                    <span class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full bg-[#EF4444] shadow-2xs"></span>
                      <span>On Leave / Inactive</span>
                    </span>
                    ${(s.academicStatus === 'Inactive' || s.academicStatus === 'On Leave') ? '<span class="text-[#991B1B] text-xs font-bold">✓</span>' : ''}
                  </button>
                </div>
              </div>
              <div class="my-1 border-t border-[#F1EFEA]"></div>
              <button onclick="deleteStudent('${s.id}', event)" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#EF4444] hover:bg-[#FEE2E2]/60 transition-colors cursor-pointer whitespace-nowrap">
                <svg class="w-4 h-4 text-[#EF4444] shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                  <path d="M3 6h18"></path>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
                <span>Delete</span>
              </button>
            </div>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function updateStudentDirectoryRowsOnly() {
  const tbody = document.getElementById('student-directory-table-body');
  if (!tbody) {
    renderApp();
    return;
  }
  const filtered = getFilteredStudentsForDirectory();
  tbody.innerHTML = renderStudentDirectoryRows(filtered);
}

const debouncedStudentDirectorySearch = debounce(function(q) {
  AppState.studentDirectorySearchQuery = q;
  updateStudentDirectoryRowsOnly();
  const countEl = document.getElementById('student-directory-count-pill');
  if (countEl) {
    const filtered = getFilteredStudentsForDirectory();
    countEl.textContent = `${filtered.length} Total Students`;
  }
}, 200);

function handleStudentDirectorySearch(q) {
  debouncedStudentDirectorySearch(q);
}
window.handleStudentDirectorySearch = handleStudentDirectorySearch;

function clearStudentDirectorySearch() {
  AppState.studentDirectorySearchQuery = '';
  const input = document.getElementById('student-directory-search-input');
  if (input) input.value = '';
  renderApp();
}
window.clearStudentDirectorySearch = clearStudentDirectorySearch;

function setStudentDirectoryStatusFilter(status) {
  AppState.studentDirectoryStatusFilter = status;
  renderApp();
}
window.setStudentDirectoryStatusFilter = setStudentDirectoryStatusFilter;

function setStudentDirectoryCourseFilter(course) {
  AppState.studentDirectoryCourseFilter = course;
  renderApp();
}
window.setStudentDirectoryCourseFilter = setStudentDirectoryCourseFilter;

function setStudentDirectoryTeacherFilter(teacherName) {
  AppState.studentDirectoryTeacherFilter = teacherName;
  renderApp();
}
window.setStudentDirectoryTeacherFilter = setStudentDirectoryTeacherFilter;

function setStudentDirectoryFeeFilter(status) {
  AppState.studentDirectoryFeeFilter = status;
  renderApp();
}
window.setStudentDirectoryFeeFilter = setStudentDirectoryFeeFilter;

function resetStudentDirectoryAdvancedFilters() {
  AppState.studentDirectoryCourseFilter = 'all';
  AppState.studentDirectoryTeacherFilter = 'all';
  AppState.studentDirectoryFeeFilter = 'all';
  renderApp();
}
window.resetStudentDirectoryAdvancedFilters = resetStudentDirectoryAdvancedFilters;

function handleStudentDirectoryCountryFilter(country) {
  AppState.studentDirectoryCountryFilter = country;
  renderApp();
}

function resetStudentDirectoryFilters() {
  AppState.studentDirectoryStatusFilter = 'all';
  AppState.studentDirectoryCountryFilter = 'all';
  AppState.studentDirectoryCourseFilter = 'all';
  AppState.studentDirectoryTeacherFilter = 'all';
  AppState.studentDirectoryFeeFilter = 'all';
  AppState.studentDirectorySearchQuery = '';
  renderApp();
}
window.resetStudentDirectoryFilters = resetStudentDirectoryFilters;

function toggleStudentContactPopover(studentId, event) {
  if (event) event.stopPropagation();
  AppState.activeStudentActionMenuId = null;
  AppState.activeStudentSchedulePopoverId = null;
  AppState.activeStudentContactPopoverId = (AppState.activeStudentContactPopoverId === studentId) ? null : studentId;
  updateStudentDirectoryRowsOnly();
}

function closeStudentContactPopover() {
  if (AppState.activeStudentContactPopoverId) {
    AppState.activeStudentContactPopoverId = null;
    updateStudentDirectoryRowsOnly();
  }
}

function toggleStudentSchedulePopover(studentId, event) {
  if (event) event.stopPropagation();
  AppState.activeStudentActionMenuId = null;
  AppState.activeStudentContactPopoverId = null;
  AppState.activeStudentSchedulePopoverId = (AppState.activeStudentSchedulePopoverId === studentId) ? null : studentId;
  updateStudentDirectoryRowsOnly();
}

function closeStudentSchedulePopover() {
  if (AppState.activeStudentSchedulePopoverId) {
    AppState.activeStudentSchedulePopoverId = null;
    updateStudentDirectoryRowsOnly();
  }
}

function toggleStudentActionMenu(studentId, event) {
  if (event) event.stopPropagation();
  AppState.activeStudentSchedulePopoverId = null;
  AppState.activeStudentContactPopoverId = null;
  AppState.activeStudentActionMenuId = (AppState.activeStudentActionMenuId === studentId) ? null : studentId;
  updateStudentDirectoryRowsOnly();
}

function closeStudentActionMenu() {
  if (AppState.activeStudentActionMenuId) {
    AppState.activeStudentActionMenuId = null;
    updateStudentDirectoryRowsOnly();
  }
}

function copyToClipboard(text, toastMsg = 'Copied to clipboard!') {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToastNotification(`✓ ${toastMsg}`);
    }).catch(() => {
      showToastNotification(`✓ ${text}`);
    });
  } else {
    showToastNotification(`✓ ${text}`);
  }
}

function setStudentStatus(studentId, newStatus, event) {
  if (event) event.stopPropagation();
  const student = AppState.students.find(s => s.id === studentId);
  if (!student) return;

  student.academicStatus = newStatus;
  saveToStorage('lms_students', AppState.students);
  dbSaveStudent(student);
  AppState.activeStudentActionMenuId = null;
  renderApp();

  const label = newStatus === 'Inactive' ? 'On Leave / Inactive' : newStatus;
  showToastNotification(`✓ ${student.firstName}'s status updated to "${label}"`);
}

function toggleStatusSubmenu(studentId, event) {
  if (event) event.stopPropagation();
  const submenu = document.getElementById(`status-submenu-${studentId}`);
  if (submenu) {
    submenu.classList.toggle('!block');
  }
}

function toggleStudentStatus(studentId, event) {
  toggleStatusSubmenu(studentId, event);
}

function deleteStudent(studentId, event) {
  if (event) {
    event.stopPropagation();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
  const student = (AppState.students || []).find(s => 
    s.id === studentId || 
    String(s.id).trim().toLowerCase() === String(studentId).trim().toLowerCase()
  );
  if (!student) return;

  const msg = `Are you sure you want to delete student "${student.firstName} ${student.lastName}" (${student.id})? This will permanently remove all their fee payments, receipts, ledger entries, and records.`;
  openDeleteConfirmationModal({
    title: 'Delete Student Record',
    message: msg,
    onConfirm: async () => {
      AppState.activeStudentActionMenuId = null;
      const success = await dbDeleteStudent(student.id);
      if (success) {
        addSystemNotification({
          title: 'Student Record Removed',
          desc: `Permanently deleted student record for ${student.firstName} ${student.lastName} (${student.id}) and all associated fees.`,
          type: 'student'
        });
        showToastNotification(`✓ Student "${student.firstName} ${student.lastName}" deleted.`);
      }
    }
  });
}
window.deleteStudent = deleteStudent;

function exportStudentsToCSV() {
  const studentsToExport = (typeof getFilteredStudentsForDirectory === 'function') 
    ? getFilteredStudentsForDirectory() 
    : (AppState.students || []);
  if (!studentsToExport || studentsToExport.length === 0) {
    showToastNotification('No students found to export.');
    return;
  }
  const headers = ['Student ID', 'First Name', 'Last Name', 'Status', 'Course', 'Teacher', 'Guardian Name', 'Phone', 'WhatsApp', 'Email', 'Country', 'Timezone', 'Monthly Fee', 'Currency'];
  const rows = studentsToExport.map(s => {
    const teacher = AppState.teachers.find(t => t.id === s.teacherId);
    return [
      s.id,
      `"${s.firstName}"`,
      `"${s.lastName || ''}"`,
      s.academicStatus || 'Active',
      `"${s.course || ''}"`,
      `"${teacher ? teacher.name : ''}"`,
      `"${s.guardianName || ''}"`,
      `"${s.phone || ''}"`,
      `"${s.whatsapp || ''}"`,
      `"${s.email || ''}"`,
      `"${s.country || ''}"`,
      `"${s.timezone || ''}"`,
      s.monthlyFee || 0,
      s.currencyCode || 'USD'
    ].join(',');
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `QuranicSkills_Students_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToastNotification('✓ Exported student directory to CSV successfully!');
}

// Global click-outside listener for floating action menu, schedule popover & contact popover
if (typeof window !== 'undefined' && !window.__studentDirectoryListenerAttached) {
  window.__studentDirectoryListenerAttached = true;
  document.addEventListener('click', function (e) {
    let reRenderNeeded = false;
    let ledgerReRenderNeeded = false;
    if (!e.target.closest('.student-action-menu-container')) {
      if (AppState.activeStudentActionMenuId) {
        AppState.activeStudentActionMenuId = null;
        reRenderNeeded = true;
      }
    }
    if (!e.target.closest('.ledger-action-menu-container')) {
      if (AppState.activeLedgerActionMenuId) {
        AppState.activeLedgerActionMenuId = null;
        ledgerReRenderNeeded = true;
      }
    }
    if (!e.target.closest('.student-schedule-popover-container')) {
      if (AppState.activeStudentSchedulePopoverId) {
        AppState.activeStudentSchedulePopoverId = null;
        reRenderNeeded = true;
      }
    }
    if (!e.target.closest('.student-contact-popover-container')) {
      if (AppState.activeStudentContactPopoverId) {
        AppState.activeStudentContactPopoverId = null;
        reRenderNeeded = true;
      }
    }
    if (!e.target.closest('.notice-action-menu-container')) {
      if (AppState.activeNoticeActionMenuId) {
        AppState.activeNoticeActionMenuId = null;
        if (AppState.activeNav === 'trials-notices') {
          ledgerReRenderNeeded = true;
        }
      }
    }
    if (reRenderNeeded) {
      updateStudentDirectoryRowsOnly();
    }
    if (ledgerReRenderNeeded) {
      renderApp();
    }
  });
}

function renderAdminStudentsDirectory() {
  const filteredStudents = getFilteredStudentsForDirectory();
  const totalStudents = AppState.students.length;

  // Status Filter Counts
  const counts = {
    all: totalStudents,
    active: AppState.students.filter(s => (s.academicStatus || 'Active') === 'Active').length,
    onTrial: AppState.students.filter(s => s.academicStatus === 'On Trial').length,
    onLeave: AppState.students.filter(s => s.academicStatus === 'On Leave').length,
    inactive: AppState.students.filter(s => s.academicStatus === 'Inactive').length
  };

  const currentStatus = AppState.studentDirectoryStatusFilter || 'all';

  const filterTabs = [
    { key: 'all', label: 'All Students', count: counts.all },
    { key: 'Active', label: 'Active', count: counts.active },
    { key: 'On Trial', label: 'On Trial', count: counts.onTrial },
    { key: 'On Leave', label: 'On Leave / Paused', count: counts.onLeave },
    { key: 'Inactive', label: 'Inactive', count: counts.inactive }
  ];

  return `
    <div class="ts-card p-3.5 sm:p-6 mb-8 overflow-hidden">
      <!-- 1. Top Control Toolbar: Row 1 (Sub-Header Action Row - Reference Matched) -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-bold text-[#141F1E]">Student Directory</h2>
          <span id="student-directory-count-pill" class="px-3 py-1 rounded-full bg-[#F1EFEA] text-xs font-bold text-[#0E4D45]">
            ${filteredStudents.length} Total Students
          </span>
        </div>

        <div class="flex items-center gap-2.5 flex-wrap w-full sm:w-auto">
          <!-- Export Pill Button -->
          <button onclick="exportStudentsToCSV()" class="flex-1 sm:flex-initial justify-center px-4 py-2 rounded-full bg-[#F8F6F1] hover:bg-[#E8EFEE] border border-[#ECEAE4] text-xs font-bold text-[#141F1E] transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer" title="Export student directory to CSV">
            <svg class="w-3.5 h-3.5 text-[#7A8684]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
            <span>Export</span>
          </button>

          <!-- + Add Student Primary Action Button (Prominently placed in Student Directory) -->
          <button onclick="openAddStudentModal()" class="flex-1 sm:flex-initial justify-center px-5 py-2.5 rounded-full bg-[#0E4D45] text-white text-xs font-bold hover:bg-[#14534B] transition-all shadow-sm flex items-center gap-2 whitespace-nowrap cursor-pointer">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
            <span>+ Add Student</span>
          </button>
        </div>
      </div>

      <!-- 1. Top Control Toolbar: Row 2 (Filter Pills + Search Bar Row) -->
      <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 mb-4 pb-4 border-b border-[#ECEAE4]">
        <!-- Quick Status Filter Pills matching Customer | Task toggle -->
        <div class="inline-flex p-1 bg-[#F8F6F1] rounded-full border border-[#ECEAE4] gap-1 overflow-x-auto shrink-0">
          ${filterTabs.map(tab => {
            const isActive = currentStatus === tab.key;
            return `
              <button 
                onclick="setStudentDirectoryStatusFilter('${tab.key}')" 
                class="px-3.5 py-1.5 rounded-full text-xs transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  isActive 
                    ? 'bg-[#0E4D45] text-white font-bold shadow-xs' 
                    : 'text-[#7A8684] hover:text-[#141F1E] hover:bg-white/60 font-medium'
                }"
              >
                <span>${tab.label}</span>
                <span class="text-[10px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-[#ECEAE4] text-[#7A8684]'} font-bold">
                  ${tab.count}
                </span>
              </button>
            `;
          }).join('')}
        </div>

        <!-- Sleek Rounded Search Bar -->
        <div class="relative w-full md:w-80">
          <span class="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-[#94A3B8]">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </span>
          <input 
            type="text" 
            id="student-directory-search-input" 
            value="${AppState.studentDirectorySearchQuery || ''}" 
            oninput="handleStudentDirectorySearch(this.value)" 
            placeholder="Search students, IDs, or teachers..." 
            class="w-full pl-10 pr-8 py-2 text-xs rounded-full border border-[#ECEAE4] bg-white text-[#141F1E] placeholder-[#94A3B8] focus:outline-none focus:border-[#0E4D45] focus:ring-1 focus:ring-[#0E4D45] transition-all shadow-2xs"
          />
          ${AppState.studentDirectorySearchQuery ? `
            <button onclick="clearStudentDirectorySearch()" class="absolute inset-y-0 right-0 flex items-center pr-3 text-[#94A3B8] hover:text-[#141F1E] cursor-pointer" title="Clear search">✕</button>
          ` : ''}
        </div>
      </div>

      <!-- Advanced Multi-Criteria Filter Bar (Course, Teacher, Fee Status) -->
      <div class="flex items-center gap-2.5 mb-5 flex-wrap text-xs">
        <span class="text-[11px] font-semibold text-[#7A8684] shrink-0">Filter by:</span>

        <!-- Course Filter Dropdown -->
        <select 
          id="student-course-filter" 
          onchange="setStudentDirectoryCourseFilter(this.value)" 
          class="px-3 py-1.5 rounded-full border border-[#ECEAE4] bg-[#F8F6F1] text-xs font-semibold text-[#141F1E] focus:outline-none focus:border-[#0E4D45] cursor-pointer"
        >
          <option value="all">All Courses</option>
          ${CANONICAL_COURSES.map(c => {
            const displayLabel = c === 'New Muslim Essentials' ? 'New Muslim Essentials (Islamic basics for reverts)' : c;
            return `<option value="${c}" ${AppState.studentDirectoryCourseFilter === c ? 'selected' : ''}>${displayLabel}</option>`;
          }).join('')}
        </select>

        <!-- Teacher Filter Dropdown -->
        <select 
          id="student-teacher-filter" 
          onchange="setStudentDirectoryTeacherFilter(this.value)" 
          class="px-3 py-1.5 rounded-full border border-[#ECEAE4] bg-[#F8F6F1] text-xs font-semibold text-[#141F1E] focus:outline-none focus:border-[#0E4D45] cursor-pointer"
        >
          <option value="all">All Faculty</option>
          ${AppState.teachers.map(t => `
            <option value="${t.name}" ${AppState.studentDirectoryTeacherFilter === t.name ? 'selected' : ''}>${t.name}</option>
          `).join('')}
        </select>

        <!-- Fee Status Filter Dropdown -->
        <select 
          id="student-fee-filter" 
          onchange="setStudentDirectoryFeeFilter(this.value)" 
          class="px-3 py-1.5 rounded-full border border-[#ECEAE4] bg-[#F8F6F1] text-xs font-semibold text-[#141F1E] focus:outline-none focus:border-[#0E4D45] cursor-pointer"
        >
          <option value="all">All Fee Statuses</option>
          <option value="paid" ${AppState.studentDirectoryFeeFilter === 'paid' ? 'selected' : ''}>Paid</option>
          <option value="partial" ${AppState.studentDirectoryFeeFilter === 'partial' ? 'selected' : ''}>Partial</option>
          <option value="defaulter" ${AppState.studentDirectoryFeeFilter === 'defaulter' ? 'selected' : ''}>Overdue / Defaulter</option>
          <option value="advance" ${AppState.studentDirectoryFeeFilter === 'advance' ? 'selected' : ''}>Advance</option>
        </select>

        ${(AppState.studentDirectoryCourseFilter && AppState.studentDirectoryCourseFilter !== 'all') || 
          (AppState.studentDirectoryTeacherFilter && AppState.studentDirectoryTeacherFilter !== 'all') || 
          (AppState.studentDirectoryFeeFilter && AppState.studentDirectoryFeeFilter !== 'all') ? `
          <button type="button" onclick="resetStudentDirectoryAdvancedFilters()" class="text-[11px] font-bold text-[#0E4D45] hover:underline cursor-pointer">
            Reset Filters
          </button>
        ` : ''}
      </div>

      <!-- 2. Ultra-Clean Single-Line Table (Converts to Cards on Mobile) -->
      <div class="overflow-x-auto min-h-[380px]">
        <table class="w-full text-left border-collapse responsive-table-cards">
          <thead>
            <tr class="border-b border-[#ECEAE4] text-[11px] font-semibold text-[#7A8684]">
              <th class="py-3 px-2.5 w-8">
                <input 
                  type="checkbox" 
                  id="select-all-students-cb" 
                  onchange="toggleSelectAllStudents(this.checked)" 
                  class="rounded border-[#ECEAE4] text-[#0E4D45] focus:ring-[#0E4D45] cursor-pointer" 
                  ${AppState.selectedStudentIds && AppState.selectedStudentIds.size > 0 && AppState.selectedStudentIds.size === filteredStudents.length ? 'checked' : ''}
                />
              </th>
              <th class="py-3 px-2.5">Student Name</th>
              <th class="py-3 px-2.5">Course Track</th>
              <th class="py-3 px-2.5">Assigned Teacher</th>
              <th class="py-3 px-2.5">Guardian Contact</th>
              <th class="py-3 px-2.5">Agreed Fee</th>
              <th class="py-3 px-2.5">Timetable</th>
              <th class="py-3 px-2.5">Status</th>
              <th class="py-3 px-2.5 w-10 text-right"></th>
            </tr>
          </thead>
          <tbody id="student-directory-table-body" class="divide-y divide-[#F1EFEA] text-xs">
            ${renderStudentDirectoryRows(filteredStudents)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ==========================================
// 8A0. TEACHER PAYROLL (PKR) — SETTINGS, FORMULA & MONTH RECORDS
// All payroll amounts are PKR. The monthly Net Payable is computed live
// from the global payroll rules (Firestore settings/payroll) and each
// teacher's assigned active students, weighted by class duration.
// A month once marked Paid is frozen: its recorded snapshot is shown
// and never recalculated.
// ==========================================

const DEFAULT_PAYROLL_SETTINGS = {
  basicSalary: 25000,
  basicUnits: 9,
  extraRate: 2250,
  allowance: 3500,
  deduction: 2000
};
const PAYROLL_SETTINGS_CACHE_KEY = 'lms_payroll_settings';
// Class duration (minutes) -> student units for payroll weighting.
const CLASS_DURATION_UNITS = { 15: 0.5, 30: 1, 60: 2 };
let payrollSettingsLoaded = false;
let payrollSettingsLoading = false;
let legacyPayrollMigrated = false;

function formatPKR(amount) {
  const n = Math.round(Number(amount) || 0);
  return 'Rs. ' + n.toLocaleString('en-US');
}

function formatPayrollUnits(units) {
  const r = Math.round((Number(units) || 0) * 100) / 100;
  return String(r);
}

function getPayrollSettings() {
  return { ...DEFAULT_PAYROLL_SETTINGS, ...(AppState.payrollSettings || {}) };
}

// Month key for the displayed/selected payroll month, e.g. "2026-11".
function getPayrollMonthKey(monthIndex) {
  const idx = (typeof monthIndex === 'number' && !isNaN(monthIndex)) ? monthIndex : CURRENT_MONTH_INDEX;
  return `${CURRENT_YEAR}-${String(idx + 1).padStart(2, '0')}`;
}

// Class duration in minutes for one student. Old records without the field
// count as the standard 30-minute class (1.0 unit).
function getStudentClassDurationMinutes(student) {
  const d = Number(student && student.classDuration);
  return (d === 15 || d === 30 || d === 60) ? d : 30;
}

function getStudentClassUnits(student) {
  return CLASS_DURATION_UNITS[getStudentClassDurationMinutes(student)] || 1;
}

// Assigned students with an Active academic status (missing status counts
// as Active, matching the rest of the app).
function getTeacherActiveStudents(teacher) {
  return (AppState.students || []).filter(s =>
    s.teacherId === teacher.id && (s.academicStatus || 'Active') === 'Active'
  );
}

function getTeacherPayrollRecord(teacher, monthKey) {
  if (!teacher || !teacher.payrollMonths) return null;
  return teacher.payrollMonths[monthKey] || null;
}

// Full payroll computation for one teacher for the displayed month.
// Paid months return their recorded snapshot (frozen history); Pending
// months are computed live from the current settings + bonus.
function computeTeacherPayroll(teacher, monthIndex) {
  const settings = getPayrollSettings();
  const monthKey = getPayrollMonthKey(monthIndex);
  const activeStudents = getTeacherActiveStudents(teacher);
  const units = activeStudents.reduce((sum, s) => sum + getStudentClassUnits(s), 0);
  const extraUnits = Math.max(0, units - settings.basicUnits);
  const extraPay = extraUnits * settings.extraRate;
  const basicExtra = settings.basicSalary + extraPay;
  const record = getTeacherPayrollRecord(teacher, monthKey);
  const bonus = record ? (Number(record.bonus) || 0) : 0;

  if (record && record.status === 'Paid' && typeof record.paidAmount === 'number') {
    return {
      monthKey,
      units,
      activeCount: activeStudents.length,
      extraUnits,
      extraPay,
      basicExtra: (typeof record.basicExtra === 'number' ? record.basicExtra : basicExtra),
      allowance: (typeof record.allowance === 'number' ? record.allowance : settings.allowance),
      deduction: (typeof record.deduction === 'number' ? record.deduction : settings.deduction),
      bonus: (typeof record.bonus === 'number' ? record.bonus : bonus),
      netPayable: record.paidAmount,
      isPaid: true,
      paidAmount: record.paidAmount,
      paidAt: record.paidAt || null
    };
  }

  return {
    monthKey,
    units,
    activeCount: activeStudents.length,
    extraUnits,
    extraPay,
    basicExtra,
    allowance: settings.allowance,
    deduction: settings.deduction,
    bonus,
    netPayable: basicExtra + settings.allowance + bonus - settings.deduction,
    isPaid: false,
    paidAmount: null,
    paidAt: null
  };
}

// One-time migration: teachers marked Paid under the old USD/hourly system
// carry no per-month record. Seed one for the displayed month snapshotting
// the new-formula net, so their Paid status survives the switch and the
// month is frozen from here on. Never runs twice per session.
function migrateLegacyPayrollStatus() {
  if (legacyPayrollMigrated) return;
  legacyPayrollMigrated = true;
  const monthKey = getPayrollMonthKey();
  let changed = false;
  (AppState.teachers || []).forEach(t => {
    if (!t.payrollMonths) t.payrollMonths = {};
    if (t.payrollMonths[monthKey]) return;
    if ((t.salaryStatus || 'Pending') !== 'Paid') return;
    const calc = computeTeacherPayroll(t);
    t.payrollMonths[monthKey] = {
      status: 'Paid',
      bonus: calc.bonus,
      basicExtra: calc.basicExtra,
      allowance: calc.allowance,
      deduction: calc.deduction,
      paidAmount: calc.netPayable,
      paidAt: new Date().toISOString(),
      migratedFromLegacy: true
    };
    changed = true;
    dbSaveTeacher(t).catch(() => {});
  });
  if (changed) saveCache('lms_teachers', AppState.teachers);
}

// Load the global payroll rules: local cache first (instant/offline), then
// Firestore settings/payroll as the source of truth; defaults when the doc
// does not exist yet.
async function loadPayrollSettings() {
  try {
    const cached = loadCache(PAYROLL_SETTINGS_CACHE_KEY, null);
    if (cached && typeof cached === 'object') {
      AppState.payrollSettings = { ...DEFAULT_PAYROLL_SETTINGS, ...cached };
    }
  } catch (e) {}
  if (typeof db !== 'undefined' && db) {
    try {
      const snap = await firestoreGetWithTimeout(db.collection('settings').doc('payroll').get());
      if (snap && snap.exists && snap.data()) {
        const d = snap.data();
        const num = (v, fallback, min) => {
          const n = Number(v);
          return (!isNaN(n) && n >= min) ? n : fallback;
        };
        AppState.payrollSettings = {
          basicSalary: num(d.basicSalary, DEFAULT_PAYROLL_SETTINGS.basicSalary, 0),
          basicUnits: num(d.basicUnits, DEFAULT_PAYROLL_SETTINGS.basicUnits, 0),
          extraRate: num(d.extraRate, DEFAULT_PAYROLL_SETTINGS.extraRate, 0),
          allowance: num(d.allowance, DEFAULT_PAYROLL_SETTINGS.allowance, 0),
          deduction: num(d.deduction, DEFAULT_PAYROLL_SETTINGS.deduction, 0)
        };
        saveCache(PAYROLL_SETTINGS_CACHE_KEY, AppState.payrollSettings);
      }
    } catch (e) {
      console.warn('[Payroll] Could not load payroll settings from cloud:', e.message);
    }
  }
  migrateLegacyPayrollStatus();
}

async function savePayrollSettingsToCloud(settings) {
  if (typeof db === 'undefined' || !db) {
    firestoreSyncError = 'Firestore is not connected (database may not exist yet).';
    return false;
  }
  try {
    await db.collection('settings').doc('payroll').set(
      { ...settings, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    return true;
  } catch (e) {
    firestoreSyncError = e.message;
    console.warn('[Payroll] Error saving payroll settings:', e.message);
    return false;
  }
}

function openPayrollSettingsModal() {
  const modal = document.getElementById('payroll-settings-modal');
  if (!modal) return;
  const s = getPayrollSettings();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('payroll-setting-basic-salary', s.basicSalary);
  set('payroll-setting-basic-units', s.basicUnits);
  set('payroll-setting-extra-rate', s.extraRate);
  set('payroll-setting-allowance', s.allowance);
  set('payroll-setting-deduction', s.deduction);
  modal.classList.add('active');
}
window.openPayrollSettingsModal = openPayrollSettingsModal;

function closePayrollSettingsModal() {
  const modal = document.getElementById('payroll-settings-modal');
  if (modal) modal.classList.remove('active');
}
window.closePayrollSettingsModal = closePayrollSettingsModal;

async function handleSavePayrollSettings() {
  const current = getPayrollSettings();
  const read = (id, fallback, min) => {
    const raw = document.getElementById(id)?.value;
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const n = Number(raw);
    return (!isNaN(n) && n >= min) ? n : fallback;
  };
  const next = {
    basicSalary: read('payroll-setting-basic-salary', current.basicSalary, 0),
    basicUnits: read('payroll-setting-basic-units', current.basicUnits, 0),
    extraRate: read('payroll-setting-extra-rate', current.extraRate, 0),
    allowance: read('payroll-setting-allowance', current.allowance, 0),
    deduction: read('payroll-setting-deduction', current.deduction, 0)
  };
  const ok = await savePayrollSettingsToCloud(next);
  if (!ok) {
    showToastNotification(`Could not save to cloud: ${firestoreSyncError || 'Firestore is not available'} — settings not saved.`, 'error');
    return;
  }
  AppState.payrollSettings = next;
  saveCache(PAYROLL_SETTINGS_CACHE_KEY, next);
  closePayrollSettingsModal();
  renderApp();
  showToastNotification('✓ Payroll settings saved. Unpaid payroll figures recalculated.');
}
window.handleSavePayrollSettings = handleSavePayrollSettings;


// ==== PKR CURRENCY MODULE START ====
// ==========================================
// 7c. MULTI-CURRENCY → PKR (Dashboard, Ledger, Directory)
// Base currency is PKR. Exchange rates live in Firestore
// (settings/currency), refresh automatically once a month from a free
// public API, and can be edited by hand in the Currency Settings modal.
// A rate edited by hand is kept even after a monthly automatic update.
// A payment's PKR equivalent is frozen when it is recorded
// (pkrAmount / pkrRate / pkrMonth on the payment doc) and is never
// recalculated. Unpaid balances always convert at the CURRENT rate.
// Amounts whose currency has no rate are never mixed into PKR totals.
// ==========================================

// Full ISO 4217 currency list (code + English name), alphabetical.
const ISO_CURRENCIES = [
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'AFN', name: 'Afghan Afghani' },
  { code: 'ALL', name: 'Albanian Lek' },
  { code: 'AMD', name: 'Armenian Dram' },
  { code: 'ANG', name: 'Netherlands Antillean Guilder' },
  { code: 'AOA', name: 'Angolan Kwanza' },
  { code: 'ARS', name: 'Argentine Peso' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'AWG', name: 'Aruban Florin' },
  { code: 'AZN', name: 'Azerbaijani Manat' },
  { code: 'BAM', name: 'Bosnia-Herzegovina Convertible Mark' },
  { code: 'BBD', name: 'Barbadian Dollar' },
  { code: 'BDT', name: 'Bangladeshi Taka' },
  { code: 'BGN', name: 'Bulgarian Lev' },
  { code: 'BHD', name: 'Bahraini Dinar' },
  { code: 'BIF', name: 'Burundian Franc' },
  { code: 'BMD', name: 'Bermudian Dollar' },
  { code: 'BND', name: 'Brunei Dollar' },
  { code: 'BOB', name: 'Bolivian Boliviano' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'BSD', name: 'Bahamian Dollar' },
  { code: 'BTN', name: 'Bhutanese Ngultrum' },
  { code: 'BWP', name: 'Botswana Pula' },
  { code: 'BYN', name: 'Belarusian Ruble' },
  { code: 'BZD', name: 'Belize Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'CDF', name: 'Congolese Franc' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CLP', name: 'Chilean Peso' },
  { code: 'CLF', name: 'Chilean Unit of Account (UF)' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'CNH', name: 'Chinese Yuan (offshore)' },
  { code: 'COP', name: 'Colombian Peso' },
  { code: 'CRC', name: 'Costa Rican Colon' },
  { code: 'CUP', name: 'Cuban Peso' },
  { code: 'CVE', name: 'Cape Verdean Escudo' },
  { code: 'CZK', name: 'Czech Koruna' },
  { code: 'DJF', name: 'Djiboutian Franc' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'DOP', name: 'Dominican Peso' },
  { code: 'DZD', name: 'Algerian Dinar' },
  { code: 'EGP', name: 'Egyptian Pound' },
  { code: 'ERN', name: 'Eritrean Nakfa' },
  { code: 'ETB', name: 'Ethiopian Birr' },
  { code: 'EUR', name: 'Euro' },
  { code: 'FJD', name: 'Fijian Dollar' },
  { code: 'FKP', name: 'Falkland Islands Pound' },
  { code: 'FOK', name: 'Faroese Króna' },
  { code: 'GBP', name: 'British Pound Sterling' },
  { code: 'GEL', name: 'Georgian Lari' },
  { code: 'GHS', name: 'Ghanaian Cedi' },
  { code: 'GIP', name: 'Gibraltar Pound' },
  { code: 'GGP', name: 'Guernsey Pound' },
  { code: 'GMD', name: 'Gambian Dalasi' },
  { code: 'GNF', name: 'Guinean Franc' },
  { code: 'GTQ', name: 'Guatemalan Quetzal' },
  { code: 'GYD', name: 'Guyanese Dollar' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'HNL', name: 'Honduran Lempira' },
  { code: 'HRK', name: 'Croatian Kuna' },
  { code: 'HTG', name: 'Haitian Gourde' },
  { code: 'HUF', name: 'Hungarian Forint' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'ILS', name: 'Israeli New Shekel' },
  { code: 'IMP', name: 'Isle of Man Pound' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'IQD', name: 'Iraqi Dinar' },
  { code: 'IRR', name: 'Iranian Rial' },
  { code: 'ISK', name: 'Icelandic Krona' },
  { code: 'JMD', name: 'Jamaican Dollar' },
  { code: 'JEP', name: 'Jersey Pound' },
  { code: 'JOD', name: 'Jordanian Dinar' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'KES', name: 'Kenyan Shilling' },
  { code: 'KID', name: 'Kiribati Dollar' },
  { code: 'KGS', name: 'Kyrgystani Som' },
  { code: 'KHR', name: 'Cambodian Riel' },
  { code: 'KMF', name: 'Comorian Franc' },
  { code: 'KPW', name: 'North Korean Won' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'KWD', name: 'Kuwaiti Dinar' },
  { code: 'KYD', name: 'Cayman Islands Dollar' },
  { code: 'KZT', name: 'Kazakhstani Tenge' },
  { code: 'LAK', name: 'Laotian Kip' },
  { code: 'LBP', name: 'Lebanese Pound' },
  { code: 'LKR', name: 'Sri Lankan Rupee' },
  { code: 'LRD', name: 'Liberian Dollar' },
  { code: 'LSL', name: 'Lesotho Loti' },
  { code: 'LYD', name: 'Libyan Dinar' },
  { code: 'MAD', name: 'Moroccan Dirham' },
  { code: 'MDL', name: 'Moldovan Leu' },
  { code: 'MGA', name: 'Malagasy Ariary' },
  { code: 'MKD', name: 'Macedonian Denar' },
  { code: 'MMK', name: 'Myanma Kyat' },
  { code: 'MNT', name: 'Mongolian Tugrik' },
  { code: 'MOP', name: 'Macanese Pataca' },
  { code: 'MRU', name: 'Mauritanian Ouguiya' },
  { code: 'MUR', name: 'Mauritian Rupee' },
  { code: 'MVR', name: 'Maldivian Rufiyaa' },
  { code: 'MWK', name: 'Malawian Kwacha' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'MZN', name: 'Mozambican Metical' },
  { code: 'NAD', name: 'Namibian Dollar' },
  { code: 'NGN', name: 'Nigerian Naira' },
  { code: 'NIO', name: 'Nicaraguan Cordoba' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'NPR', name: 'Nepalese Rupee' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'OMR', name: 'Omani Rial' },
  { code: 'PAB', name: 'Panamanian Balboa' },
  { code: 'PEN', name: 'Peruvian Sol' },
  { code: 'PGK', name: 'Papua New Guinean Kina' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'PKR', name: 'Pakistani Rupee' },
  { code: 'PLN', name: 'Polish Zloty' },
  { code: 'PYG', name: 'Paraguayan Guarani' },
  { code: 'QAR', name: 'Qatari Riyal' },
  { code: 'RON', name: 'Romanian Leu' },
  { code: 'RSD', name: 'Serbian Dinar' },
  { code: 'RUB', name: 'Russian Ruble' },
  { code: 'RWF', name: 'Rwandan Franc' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'SBD', name: 'Solomon Islands Dollar' },
  { code: 'SCR', name: 'Seychellois Rupee' },
  { code: 'SDG', name: 'Sudanese Pound' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'SHP', name: 'Saint Helena Pound' },
  { code: 'SLE', name: 'Sierra Leonean Leone' },
  { code: 'SLL', name: 'Sierra Leonean Leone' },
  { code: 'SOS', name: 'Somali Shilling' },
  { code: 'SRD', name: 'Surinamese Dollar' },
  { code: 'SSP', name: 'South Sudanese Pound' },
  { code: 'STN', name: 'Sao Tome and Principe Dobra' },
  { code: 'SYP', name: 'Syrian Pound' },
  { code: 'SZL', name: 'Swazi Lilangeni' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'TJS', name: 'Tajikistani Somoni' },
  { code: 'TMT', name: 'Turkmenistani Manat' },
  { code: 'TND', name: 'Tunisian Dinar' },
  { code: 'TOP', name: 'Tongan Pa\'anga' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'TTD', name: 'Trinidad and Tobago Dollar' },
  { code: 'TVD', name: 'Tuvaluan Dollar' },
  { code: 'TWD', name: 'New Taiwan Dollar' },
  { code: 'TZS', name: 'Tanzanian Shilling' },
  { code: 'UAH', name: 'Ukrainian Hryvnia' },
  { code: 'UGX', name: 'Ugandan Shilling' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'UYU', name: 'Uruguayan Peso' },
  { code: 'UZS', name: 'Uzbekistan Som' },
  { code: 'VED', name: 'Venezuelan Bolivar Soberano' },
  { code: 'VES', name: 'Venezuelan Bolivar Soberano' },
  { code: 'VND', name: 'Vietnamese Dong' },
  { code: 'VUV', name: 'Vanuatu Vatu' },
  { code: 'WST', name: 'Samoan Tala' },
  { code: 'XAF', name: 'Central African CFA Franc' },
  { code: 'XCD', name: 'East Caribbean Dollar' },
  { code: 'XCG', name: 'Caribbean Guilder' },
  { code: 'XDR', name: 'Special Drawing Rights' },
  { code: 'XOF', name: 'West African CFA Franc' },
  { code: 'XPF', name: 'CFP Franc' },
  { code: 'YER', name: 'Yemeni Rial' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'ZMW', name: 'Zambian Kwacha' },
  { code: 'ZWG', name: 'Zimbabwe Gold' },
  { code: 'ZWL', name: 'Zimbabwean Dollar' }
];
const ISO_CURRENCY_BY_CODE = {};
ISO_CURRENCIES.forEach(function (c) { ISO_CURRENCY_BY_CODE[c.code] = c.name; });

// Display symbol for a currency code; falls back to the code itself.
const CURRENCY_SYMBOLS = { 'USD': '$', 'GBP': '£', 'EUR': '€', 'CAD': 'C$', 'PKR': 'Rs', 'AED': 'AED', 'SAR': 'SAR', 'INR': '₹', 'AUD': 'A$', 'NZD': 'NZ$', 'JPY': '¥', 'CNY': 'CN¥', 'HKD': 'HK$', 'SGD': 'S$', 'CHF': 'CHF', 'SEK': 'kr', 'NOK': 'kr', 'DKK': 'kr', 'CZK': 'Kč', 'PLN': 'zł', 'HUF': 'Ft', 'ILS': '₪', 'THB': '฿', 'MYR': 'RM', 'IDR': 'Rp', 'PHP': '₱', 'KRW': '₩', 'TWD': 'NT$', 'ZAR': 'R', 'BRL': 'R$', 'MXN': 'MX$', 'TRY': '₺', 'RUB': '₽', 'UAH': '₴', 'QAR': 'QR', 'KWD': 'KD', 'BHD': 'BD', 'OMR': 'RO', 'JOD': 'JD', 'EGP': 'E£', 'NGN': '₦', 'KES': 'KSh', 'GEL': '₾' };
function getCurrencySymbol(code) {
  if (!code) return '$';
  const c = String(code).toUpperCase();
  return CURRENCY_SYMBOLS[c] || c;
}

// Old payment docs stored only a symbol, never a currencyCode. Resolve
// through the student / family first; this map is the last resort. All
// current data is USD, so '$' -> 'USD' is the only mapping in practice.
const CURRENCY_CODE_BY_SYMBOL = { '$': 'USD', '£': 'GBP', '€': 'EUR', 'C$': 'CAD', 'Rs': 'PKR' };

// Seeded PKR-per-1-unit rates (open.er-api.com v6, USD base, 24 Nov 2026).
// Fallback only: the monthly auto-update replaces them with fresh rates.
const DEFAULT_CURRENCY_RATES = { USD: 276.55, GBP: 360.71, CAD: 192.58, EUR: 302.03, AED: 75.30, SAR: 73.75 };
const CURRENCY_SETTINGS_CACHE_KEY = 'lms_currency_settings';
const CURRENCY_RATE_API_PRIMARY = 'https://open.er-api.com/v6/latest/USD';
const CURRENCY_RATE_API_FALLBACK = 'https://api.exchangerate-api.com/v4/latest/USD';
let currencySettingsLoaded = false;
let currencySettingsLoading = false;
let currencyRatesStale = false;
let currencySettingsDraft = null;

function currentMonthKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function currencyMonthLabel(monthKey) {
  if (!monthKey || typeof monthKey !== 'string') return '';
  const parts = monthKey.split('-');
  const m = parseInt(parts[1], 10);
  const name = (typeof FULL_MONTHS_LIST !== 'undefined' && FULL_MONTHS_LIST[m - 1]) ? FULL_MONTHS_LIST[m - 1] : ('Month ' + (parts[1] || ''));
  return name + ' ' + (parts[0] || '');
}

function getCurrencySettings() {
  const stored = (typeof AppState !== 'undefined' && AppState.currencySettings && typeof AppState.currencySettings === 'object') ? AppState.currencySettings : {};
  return {
    base: 'PKR',
    month: (typeof stored.month === 'string' && stored.month) ? stored.month : currentMonthKey(),
    updatedAt: stored.updatedAt || null,
    source: stored.source || 'seed',
    rates: Object.assign({}, DEFAULT_CURRENCY_RATES, stored.rates || {}),
    // Pure fetched/seed rates (no manual overrides) — overrides are decided
    // against these, so saving a rate equal to the automatic rate clears it.
    autoRates: Object.assign({}, DEFAULT_CURRENCY_RATES, stored.autoRates || {}),
    manualOverrides: Object.assign({}, stored.manualOverrides || {})
  };
}

function getCurrencyRate(code) {
  if (!code) return null;
  const c = String(code).toUpperCase();
  if (c === 'PKR') return 1;
  const r = Number(getCurrencySettings().rates[c]);
  return (isFinite(r) && r > 0) ? r : null;
}

// Convert an amount in `code` to whole PKR. Returns { pkr, hasRate }.
function convertToPKR(amount, code) {
  const rate = getCurrencyRate(code);
  if (rate === null) return { pkr: 0, hasRate: false };
  return { pkr: Math.round((Number(amount) || 0) * rate), hasRate: true };
}

// "Rs. 218,960" — whole rupees, thousands separators.
function formatPKRAmount(pkr) {
  return 'Rs. ' + formatPKRNumber(pkr);
}

// Grouped number only, no "Rs. " — used where "Rs." is a separate inline
// prefix (KPI amounts), so the amount never wraps with "Rs." alone on a line.
function formatPKRNumber(pkr) {
  return (Math.round(Number(pkr) || 0)).toLocaleString('en-US');
}

// Currency code for a payment doc (or one of its allocations). Old docs
// stored only a symbol; resolve through the student / family first.
function getPaymentCurrencyCode(p, a) {
  if (a && a.currencyCode) return String(a.currencyCode).toUpperCase();
  if (p && p.currencyCode) return String(p.currencyCode).toUpperCase();
  const sid = (a && a.studentId) || (p && p.studentId) || '';
  const students = (typeof AppState !== 'undefined' && AppState.students) || [];
  const s = students.find(function (x) { return String(x.id) === String(sid); });
  if (s && s.currencyCode) return String(s.currencyCode).toUpperCase();
  if (sid && typeof isFamilyTarget === 'function' && isFamilyTarget(sid)) {
    const member = students.find(function (x) { return (x.familyId === sid || x.familyTag === sid) && x.currencyCode; });
    if (member) return String(member.currencyCode).toUpperCase();
  }
  const sym = (a && a.currency) || (p && p.currency) || '';
  return CURRENCY_CODE_BY_SYMBOL[sym] || null;
}

// PKR value of one allocation inside a payment: the payment's frozen PKR
// split pro-rata across its allocations, else converted at the current
// rate. Returns { pkr, hasRate }.
function getAllocationPKR(p, a) {
  const amt = Number((a && a.allocatedAmount) || 0);
  if (amt <= 0) return { pkr: 0, hasRate: true };
  if (p && typeof p.pkrAmount === 'number' && Number(p.amount) > 0) {
    return { pkr: Math.round(p.pkrAmount * amt / Number(p.amount)), hasRate: true };
  }
  return convertToPKR(amt, getPaymentCurrencyCode(p, a));
}

// PKR collected for one month from PAYMENT_LEDGER (frozen PKR first).
// Returns { pkr, excludedCodes } where excludedCodes maps currency codes
// that had no rate (and were therefore left out of the total).
// PKR collected for one month — summed per student-month (the same values
// the Ledger shows), so the Dashboard and Ledger totals always agree.
// Returns { pkr, excludedCodes } where excludedCodes maps currency codes
// that had no rate (and were therefore left out of the total).
function getMonthFeeCollectedPKR(monthIndex, year) {
  // `year` is unused: student months are already scoped to the current
  // academic year, exactly as the Ledger totals them.
  void year;
  let pkr = 0;
  const excludedCodes = {};
  const noteExcluded = function (code) { const c = code || 'unknown'; excludedCodes[c] = (excludedCodes[c] || 0) + 1; };
  (AppState.students || []).forEach(function (s) {
    const m = Array.isArray(s.months) ? s.months[monthIndex] : null;
    if (!m) return;
    if (m.status !== 'paid' && m.status !== 'advance' && m.status !== 'partial') return;
    const r = getStudentMonthPaidPKR(s, monthIndex);
    if (r.hasRate) pkr += r.pkr;
    else if ((Number(m.amountPaid) || 0) > 0) noteExcluded(s.currencyCode);
  });
  return { pkr: pkr, excludedCodes: excludedCodes };
}

// PKR paid for one student's one month (used by the Ledger). Prefers the
// frozen PKR of the covering payment(s); any remainder converts at the
// current rate. Returns { pkr, hasRate, frozen }.
function getStudentMonthPaidPKR(student, monthIndex) {
  const m = student && Array.isArray(student.months) ? student.months[monthIndex] : null;
  if (!m) return { pkr: 0, hasRate: true };
  const amt = Number(m.amountPaid) || 0;
  if (amt <= 0) return { pkr: 0, hasRate: true };
  let frozenPkr = 0;
  let frozenCovered = 0;
  if (Array.isArray(PAYMENT_LEDGER)) {
    PAYMENT_LEDGER.forEach(function (p) {
      if (!p || !Array.isArray(p.allocations) || typeof p.pkrAmount !== 'number' || Number(p.amount) <= 0) return;
      p.allocations.forEach(function (a) {
        if (!a || a.studentId !== student.id) return;
        if (!(a.monthIndex === monthIndex || a.month === MONTHS_LIST[monthIndex] || a.month === FULL_MONTHS_LIST[monthIndex])) return;
        const alloc = Number(a.allocatedAmount) || 0;
        if (alloc <= 0) return;
        frozenPkr += Math.round(p.pkrAmount * alloc / Number(p.amount));
        frozenCovered += alloc;
      });
    });
  }
  const remainder = Math.max(0, Math.round((amt - frozenCovered) * 100) / 100);
  if (remainder <= 0) return { pkr: frozenPkr, hasRate: true, frozen: true };
  const conv = convertToPKR(remainder, student.currencyCode);
  if (!conv.hasRate) return { pkr: frozenPkr, hasRate: false };
  return { pkr: frozenPkr + conv.pkr, hasRate: true, frozen: frozenCovered > 0 };
}

// Display helpers: PKR first, original currency small beside it. When no
// rate is set, the original currency is shown on its own (never a wrong
// PKR figure).
function studentFeePKRHtml(student) {
  const fee = Number(student.monthlyFee) || 0;
  const conv = convertToPKR(fee, student.currencyCode);
  if (!conv.hasRate) return (student.currency || '$') + formatFeeAmount(fee);
  const orig = (student.currencyCode && String(student.currencyCode).toUpperCase() !== 'PKR')
    ? ' <span class="text-[10px] text-gray-400 font-normal">(' + (student.currency || '') + formatFeeAmount(fee) + ')</span>' : '';
  return formatPKRAmount(conv.pkr) + orig;
}

function studentDuePKRHtml(student, balanceDue) {
  if (!balanceDue || balanceDue <= 0) return 'Clear';
  const conv = convertToPKR(balanceDue, student.currencyCode);
  if (!conv.hasRate) return '-' + (student.currency || '$') + formatFeeAmount(balanceDue) + ' Due';
  const orig = (student.currencyCode && String(student.currencyCode).toUpperCase() !== 'PKR')
    ? ' <span class="text-[10px] font-normal">(' + (student.currency || '') + formatFeeAmount(balanceDue) + ')</span>' : '';
  return '-' + formatPKRAmount(conv.pkr) + orig + ' Due';
}

function familyPackagePKRHtml(fam, pkgFee, pkgShare) {
  const code = (fam.students && fam.students[0] && fam.students[0].currencyCode) || null;
  const feeConv = convertToPKR(pkgFee, code);
  const shareConv = convertToPKR(pkgShare, code);
  if (!feeConv.hasRate || !shareConv.hasRate) {
    return 'Package ' + (fam.currency || '$') + formatFeeAmount(pkgFee) + '/mo • ' + (fam.currency || '$') + formatFeeAmount(pkgShare) + ' per child';
  }
  const orig = (code && String(code).toUpperCase() !== 'PKR')
    ? ' (' + (fam.currency || '') + formatFeeAmount(pkgFee) + '/mo • ' + (fam.currency || '') + formatFeeAmount(pkgShare) + ' per child)' : '';
  return 'Package ' + formatPKRAmount(feeConv.pkr) + '/mo • ' + formatPKRAmount(shareConv.pkr) + ' per child' + orig;
}

function familyDuePKRHtml(fam) {
  let pkr = 0;
  let hasRate = true;
  let orig = 0;
  (fam.students || []).forEach(function (s) {
    const due = Number(getStudentBalanceDue(s)) || 0;
    orig += due;
    const conv = convertToPKR(due, s.currencyCode);
    if (conv.hasRate) pkr += conv.pkr; else if (due > 0) hasRate = false;
  });
  if (!hasRate) return '-' + (fam.currency || '$') + formatFeeAmount(fam.totalDue) + ' Due';
  const code = (fam.students && fam.students[0] && fam.students[0].currencyCode) || null;
  const origText = (code && String(code).toUpperCase() !== 'PKR')
    ? ' (' + (fam.currency || '') + formatFeeAmount(orig) + ')' : '';
  return '-' + formatPKRAmount(pkr) + origText + ' Due';
}

// Currency codes for the Ledger currency filter: every currency actually
// used by a student, plus the common ones, so the filter never hides a
// currency that exists in the data.
function ledgerCurrencyFilterCodes() {
  const used = {};
  (AppState.students || []).forEach(function (s) { if (s.currencyCode) used[String(s.currencyCode).toUpperCase()] = true; });
  ['USD', 'GBP', 'EUR', 'CAD', 'PKR'].forEach(function (c) { used[c] = true; });
  return Object.keys(used).sort();
}

// Load currency settings: local cache first, then Firestore
// settings/currency; seeded rates when nothing is stored yet. Then runs
// the monthly auto-update check once per session.
async function loadCurrencySettings() {
  try {
    const cached = loadCache(CURRENCY_SETTINGS_CACHE_KEY, null);
    if (cached && typeof cached === 'object') {
      AppState.currencySettings = {
        base: 'PKR',
        month: cached.month || currentMonthKey(),
        updatedAt: cached.updatedAt || null,
        source: cached.source || 'seed',
        rates: Object.assign({}, cached.rates || {}),
        autoRates: Object.assign({}, cached.autoRates || {}),
        manualOverrides: Object.assign({}, cached.manualOverrides || {})
      };
    }
  } catch (e) {}
  if (typeof db !== 'undefined' && db) {
    try {
      const snap = await firestoreGetWithTimeout(db.collection('settings').doc('currency').get());
      if (snap && snap.exists && snap.data()) {
        const d = snap.data();
        AppState.currencySettings = {
          base: 'PKR',
          month: (typeof d.month === 'string' && d.month) ? d.month : currentMonthKey(),
          updatedAt: d.updatedAt || null,
          source: d.source || 'manual',
          rates: Object.assign({}, d.rates || {}),
          autoRates: Object.assign({}, d.autoRates || {}),
          manualOverrides: Object.assign({}, d.manualOverrides || {})
        };
        saveCache(CURRENCY_SETTINGS_CACHE_KEY, AppState.currencySettings);
      }
    } catch (e) {
      console.warn('[Currency] Could not load currency settings from cloud:', e.message);
    }
  }
  try { await maybeUpdateCurrencyRates(false); } catch (e) {}
}

async function saveCurrencySettingsToCloud(settings) {
  if (typeof db === 'undefined' || !db) {
    firestoreSyncError = 'Firestore is not connected (database may not exist yet).';
    return false;
  }
  try {
    await db.collection('settings').doc('currency').set(
      { base: 'PKR', month: settings.month, updatedAt: settings.updatedAt, source: settings.source, rates: settings.rates, autoRates: settings.autoRates || {}, manualOverrides: settings.manualOverrides || {} },
      { merge: true }
    );
    return true;
  } catch (e) {
    firestoreSyncError = e.message;
    console.warn('[Currency] Error saving currency settings:', e.message);
    return false;
  }
}

// Fetch PKR-per-unit rates from a free public API (no key). Primary:
// open.er-api.com v6 (USD base, ~166 currencies). Fallback: the same
// provider's v4 endpoint. Returns { CODE: pkrPerUnit } or null.
async function fetchCurrencyRatesFromApi() {
  const urls = [CURRENCY_RATE_API_PRIMARY, CURRENCY_RATE_API_FALLBACK];
  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await firestoreGetWithTimeout(fetch(urls[i]));
      if (!res || !res.ok) continue;
      const data = await res.json();
      const rates = data && data.rates;
      const pkrPerUsd = Number(rates && rates.PKR);
      if (!rates || !isFinite(pkrPerUsd) || pkrPerUsd <= 0) continue;
      const out = {};
      Object.keys(rates).forEach(function (code) {
        const perUsd = Number(rates[code]);
        if (code === 'PKR' || !isFinite(perUsd) || perUsd <= 0) return;
        out[code] = Math.round((pkrPerUsd / perUsd) * 100) / 100;
      });
      out.USD = Math.round(pkrPerUsd * 100) / 100;
      return out;
    } catch (e) { /* try the next source */ }
  }
  return null;
}

// Drop manual overrides that equal the automatic rate — they are not
// overrides any more, so the next monthly fetch can update that currency.
// Returns true when an override was pruned.
function pruneStaleCurrencyOverrides(settings) {
  const auto = (settings && settings.autoRates) || {};
  const ov = (settings && settings.manualOverrides) || {};
  let changed = false;
  Object.keys(ov).forEach(function (code) {
    const a = auto[code];
    if (a !== undefined && Math.abs(Number(ov[code]) - a) <= 0.01) { delete ov[code]; changed = true; }
  });
  return changed;
}

// Monthly auto-update: when the stored rates belong to an earlier month
// (or have never been fetched), pull fresh rates and save them. Manual
// overrides always win. Returns true when rates were refreshed.
async function maybeUpdateCurrencyRates(force) {
  const current = getCurrencySettings();
  const thisMonth = currentMonthKey();
  // Self-heal: an override equal to the stored automatic rate is stale
  // (e.g. USD restored to the seed rate). Drop it so the source returns
  // to Automatic and future fetches can update that currency. The
  // effective rate does not change — only its override status.
  if (pruneStaleCurrencyOverrides(current)) {
    const cleaned = {
      base: 'PKR',
      month: current.month,
      updatedAt: current.updatedAt,
      source: Object.keys(current.manualOverrides || {}).length > 0 ? 'manual' : (current.source === 'seed' ? 'seed' : 'api'),
      rates: Object.assign({}, current.rates || {}),
      autoRates: Object.assign({}, current.autoRates || {}),
      manualOverrides: Object.assign({}, current.manualOverrides || {})
    };
    AppState.currencySettings = cleaned;
    try { saveCache(CURRENCY_SETTINGS_CACHE_KEY, cleaned); } catch (e) {}
    try { await saveCurrencySettingsToCloud(cleaned); } catch (e) {}
  }
  const fresh = getCurrencySettings();
  if (!force && fresh.month === thisMonth && fresh.source !== 'seed') return false;
  const fetched = await fetchCurrencyRatesFromApi();
  if (!fetched) {
    currencyRatesStale = fresh.month !== thisMonth;
    return false;
  }
  // An override that equals the freshly fetched rate is not an override.
  const prunedOverrides = Object.assign({}, fresh.manualOverrides || {});
  Object.keys(prunedOverrides).forEach(function (code) {
    const a = fetched[code];
    if (a !== undefined && Math.abs(Number(prunedOverrides[code]) - a) <= 0.01) delete prunedOverrides[code];
  });
  const next = {
    base: 'PKR',
    month: thisMonth,
    updatedAt: new Date().toISOString(),
    source: Object.keys(prunedOverrides).length > 0 ? 'manual' : 'api',
    rates: Object.assign({}, fetched, prunedOverrides),
    autoRates: Object.assign({}, fetched),
    manualOverrides: prunedOverrides
  };
  AppState.currencySettings = next;
  currencyRatesStale = false;
  try { saveCache(CURRENCY_SETTINGS_CACHE_KEY, next); } catch (e) {}
  try { await saveCurrencySettingsToCloud(next); } catch (e) {}
  return true;
}

function openCurrencySettingsModal() {
  const modal = document.getElementById('currency-settings-modal');
  if (!modal) return;
  // Preserve an existing draft (e.g. after a failed save, so the user's
  // edits are not lost when the modal re-opens). A normal close still
  // nulls the draft, so fresh opens start from the saved settings.
  if (!currencySettingsDraft) currencySettingsDraft = getCurrencySettings();
  currencySettingsDraft.baseRates = Object.assign({}, currencySettingsDraft.rates);
  renderCurrencySettingsInfo();
  renderCurrencyRatesTable('');
  renderCurrencyAddSelect();
  modal.classList.add('active');
}
window.openCurrencySettingsModal = openCurrencySettingsModal;

function closeCurrencySettingsModal() {
  const modal = document.getElementById('currency-settings-modal');
  if (modal) modal.classList.remove('active');
  currencySettingsDraft = null;
}
window.closeCurrencySettingsModal = closeCurrencySettingsModal;

function renderCurrencySettingsInfo() {
  const s = currencySettingsDraft || getCurrencySettings();
  const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('currency-settings-month', currencyMonthLabel(s.month));
  set('currency-settings-updated', s.updatedAt ? new Date(s.updatedAt).toLocaleString() : 'Not yet');
  set('currency-settings-source', s.source === 'api' ? 'Automatic (monthly)' : (s.source === 'manual' ? 'Manual' : 'Seed rates'));
  const note = document.getElementById('currency-settings-stale-note');
  if (note) {
    if (currencyRatesStale) {
      note.textContent = 'Rates from ' + currencyMonthLabel(s.month) + ' — could not update. Previous rates are still in use.';
      note.classList.remove('hidden');
    } else {
      note.classList.add('hidden');
    }
  }
}

function renderCurrencyRatesTable(filter) {
  const body = document.getElementById('currency-rates-table-body');
  if (!body) return;
  const s = currencySettingsDraft || getCurrencySettings();
  const q = String(filter || '').trim().toLowerCase();
  const commonFirst = ['USD', 'GBP', 'CAD', 'EUR', 'AED', 'SAR'];
  const codes = Object.keys(s.rates).sort(function (a, b) {
    const ra = commonFirst.indexOf(a);
    const rb = commonFirst.indexOf(b);
    if (ra !== -1 || rb !== -1) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
    return a < b ? -1 : (a > b ? 1 : 0);
  });
  const rows = codes.filter(function (code) {
    if (!q) return true;
    const name = (ISO_CURRENCY_BY_CODE[code] || '').toLowerCase();
    return code.toLowerCase().indexOf(q) !== -1 || name.indexOf(q) !== -1;
  });
  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="4" class="px-3 py-4 text-center text-[#7A8684]">No currency matches that search.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(function (code) {
    const isManual = s.manualOverrides && s.manualOverrides[code] !== undefined;
    return '<tr class="border-t border-[#ECEAE4]">' +
      '<td class="px-3 py-2 font-bold text-[#141F1E]">' + code + (isManual ? ' <span class="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#E8EFEE] text-[#0E4D45]">MANUAL</span>' : '') + '</td>' +
      '<td class="px-3 py-2 text-[#7A8684]">' + (ISO_CURRENCY_BY_CODE[code] || '') + '</td>' +
      '<td class="px-3 py-2 text-right"><input type="number" min="0" step="any" data-currency-rate="' + code + '" value="' + s.rates[code] + '" class="w-28 bg-[#F8F6F1] border border-[#ECEAE4] rounded-lg h-8 px-2 text-xs text-[#0E4D45] font-bold text-right outline-none focus:border-[#0E4D45] focus:bg-white transition-all"></td>' +
      '<td class="px-3 py-2 text-right">' + (isManual ? '<button type="button" onclick="handleResetCurrencyRate(\'' + code + '\')" title="Use the automatic rate" class="px-2 py-1 text-[10px] font-bold rounded-full bg-white border border-[#0E4D45] text-[#0E4D45] hover:bg-[#E8EFEE] transition-colors cursor-pointer whitespace-nowrap">Auto</button>' : '') + '</td>' +
      '</tr>';
  }).join('');
}
window.renderCurrencyRatesTable = renderCurrencyRatesTable;

// Clear one manual override and restore the automatic rate in the draft
// (Save still persists it). If no overrides remain, the source returns
// to Automatic.
function handleResetCurrencyRate(code) {
  if (!code) return;
  if (!currencySettingsDraft) currencySettingsDraft = getCurrencySettings();
  if (currencySettingsDraft.manualOverrides) delete currencySettingsDraft.manualOverrides[code];
  const auto = (currencySettingsDraft.autoRates && currencySettingsDraft.autoRates[code] !== undefined)
    ? currencySettingsDraft.autoRates[code]
    : getCurrencySettings().autoRates[code];
  if (auto !== undefined) currencySettingsDraft.rates[code] = auto;
  if (Object.keys(currencySettingsDraft.manualOverrides || {}).length === 0) {
    currencySettingsDraft.source = (currencySettingsDraft.source === 'seed' ? 'seed' : 'api');
  }
  const filterEl = document.getElementById('currency-rates-filter');
  renderCurrencyRatesTable(filterEl ? filterEl.value : '');
  renderCurrencySettingsInfo();
}
window.handleResetCurrencyRate = handleResetCurrencyRate;

function renderCurrencyAddSelect() {
  const sel = document.getElementById('currency-add-select');
  if (!sel) return;
  const s = currencySettingsDraft || getCurrencySettings();
  const have = s.rates || {};
  const missing = ISO_CURRENCIES.filter(function (c) { return have[c.code] === undefined; });
  sel.innerHTML = '<option value="" disabled selected>Add a currency…</option>' + missing.map(function (c) {
    return '<option value="' + c.code + '">' + c.code + ' — ' + c.name + '</option>';
  }).join('');
}

function handleAddCurrencyRate() {
  const sel = document.getElementById('currency-add-select');
  const input = document.getElementById('currency-add-rate');
  if (!sel || !input) return;
  const code = sel.value;
  const rate = Number(input.value);
  if (!code) { showToastNotification('Please choose a currency to add.', 'error'); return; }
  if (!isFinite(rate) || rate <= 0) { showToastNotification('Please enter a valid rate (PKR per 1 ' + code + ').', 'error'); return; }
  if (!currencySettingsDraft) currencySettingsDraft = getCurrencySettings();
  currencySettingsDraft.rates[code] = Math.round(rate * 100) / 100;
  currencySettingsDraft.manualOverrides = currencySettingsDraft.manualOverrides || {};
  currencySettingsDraft.manualOverrides[code] = currencySettingsDraft.rates[code];
  const filterEl = document.getElementById('currency-rates-filter');
  if (filterEl) filterEl.value = '';
  renderCurrencyRatesTable('');
  renderCurrencyAddSelect();
  input.value = '';
}
window.handleAddCurrencyRate = handleAddCurrencyRate;

async function handleUpdateCurrencyRatesNow() {
  const ok = await maybeUpdateCurrencyRates(true);
  if (ok) {
    currencySettingsDraft = getCurrencySettings();
    currencySettingsDraft.baseRates = Object.assign({}, currencySettingsDraft.rates);
    renderCurrencySettingsInfo();
    renderCurrencyRatesTable('');
    renderCurrencyAddSelect();
    renderApp();
    showToastNotification('✓ Exchange rates updated to the latest market rates.');
  } else {
    currencyRatesStale = true;
    renderCurrencySettingsInfo();
    showToastNotification('Could not fetch fresh rates — previous rates are still in use.', 'error');
  }
}
window.handleUpdateCurrencyRatesNow = handleUpdateCurrencyRatesNow;

async function handleSaveCurrencySettings() {
  const draft = currencySettingsDraft || getCurrencySettings();
  // Overrides are decided against the AUTOMATIC (fetched/seed) rate, not
  // the merged rate at modal open: saving a rate equal to the automatic
  // rate clears any override, so the next monthly fetch can update it.
  const autoRates = (draft.autoRates && typeof draft.autoRates === 'object') ? draft.autoRates : {};
  const saveBtn = document.getElementById('currency-settings-save-btn');
  const saveLabel = document.getElementById('currency-settings-save-label');
  const setSaving = function (on) {
    if (saveBtn) saveBtn.disabled = !!on;
    if (saveLabel) saveLabel.textContent = on ? 'Saving…' : 'Save Settings';
  };
  const inputs = document.querySelectorAll('#currency-rates-table-body input[data-currency-rate]');
  const nextRates = {};
  const nextOverrides = {};
  inputs.forEach(function (el) {
    const code = el.getAttribute('data-currency-rate');
    const n = Number(el.value);
    if (!code || !isFinite(n) || n <= 0) return;
    nextRates[code] = Math.round(n * 100) / 100;
    const auto = autoRates[code];
    if (auto === undefined || Math.abs(nextRates[code] - auto) > 0.01) nextOverrides[code] = nextRates[code];
  });
  if (Object.keys(nextRates).length === 0) {
    showToastNotification('Please set at least one exchange rate.', 'error');
    return;
  }
  const next = {
    base: 'PKR',
    month: draft.month,
    updatedAt: new Date().toISOString(),
    source: Object.keys(nextOverrides).length > 0 ? 'manual' : (draft.source === 'seed' ? 'seed' : 'api'),
    rates: nextRates,
    autoRates: Object.assign({}, autoRates),
    manualOverrides: nextOverrides
  };
  const prevSettings = getCurrencySettings();
  const failedDraft = currencySettingsDraft;
  setSaving(true);
  // Optimistic apply: close the modal and refresh the Dashboard at once,
  // then save to the cloud in the background.
  AppState.currencySettings = next;
  try { saveCache(CURRENCY_SETTINGS_CACHE_KEY, next); } catch (e) {}
  closeCurrencySettingsModal();
  renderApp();
  const ok = await saveCurrencySettingsToCloud(next);
  setSaving(false);
  if (!ok) {
    AppState.currencySettings = prevSettings;
    try { saveCache(CURRENCY_SETTINGS_CACHE_KEY, prevSettings); } catch (e) {}
    renderApp();
    currencySettingsDraft = failedDraft;
    openCurrencySettingsModal();
    showToastNotification('Could not save to cloud: ' + (firestoreSyncError || 'Firestore is not available') + ' — settings not saved.', 'error');
    return;
  }
  showToastNotification('✓ Currency settings saved. PKR figures recalculated.');
}
window.handleSaveCurrencySettings = handleSaveCurrencySettings;
// ==== PKR CURRENCY MODULE END ====

// Quick per-teacher manual bonus for the displayed month. Saved to
// Firestore on the teacher doc (awaited); Paid months are frozen and
// cannot be edited.
async function handleTeacherBonusChange(teacherId, inputEl) {
  const teacher = (AppState.teachers || []).find(t => t.id === teacherId);
  if (!teacher || !inputEl) return;
  const monthKey = getPayrollMonthKey();
  const calc = computeTeacherPayroll(teacher);
  if (calc.isPaid) { renderApp(); return; }
  let bonus = Number(inputEl.value);
  if (isNaN(bonus) || bonus < 0) bonus = 0;
  bonus = Math.round(bonus);
  if (!teacher.payrollMonths) teacher.payrollMonths = {};
  const prev = teacher.payrollMonths[monthKey] || {};
  teacher.payrollMonths[monthKey] = { ...prev, status: prev.status || 'Pending', bonus };
  saveCache('lms_teachers', AppState.teachers);
  const ok = await dbSaveTeacher(teacher);
  renderApp();
  if (ok) {
    showToastNotification(`✓ Bonus of ${formatPKR(bonus)} saved for ${teacher.name} (${MONTHS_LIST[CURRENT_MONTH_INDEX]} ${CURRENT_YEAR}).`);
  } else {
    showToastNotification(`Could not save to cloud: ${firestoreSyncError || 'Firestore is not available'} — saved on this device only.`, 'error');
  }
}
window.handleTeacherBonusChange = handleTeacherBonusChange;

// Mark the displayed month's Net Payable as Paid (snapshot frozen), or
// revert a Paid month back to Pending (bonus is kept, snapshot dropped).
async function toggleTeacherSalaryStatus(teacherId) {
  const teacher = (AppState.teachers || []).find(t => t.id === teacherId);
  if (!teacher) return;
  const monthKey = getPayrollMonthKey();
  const calc = computeTeacherPayroll(teacher);
  if (!teacher.payrollMonths) teacher.payrollMonths = {};
  if (calc.isPaid) {
    const prev = teacher.payrollMonths[monthKey] || {};
    teacher.payrollMonths[monthKey] = { ...prev, status: 'Pending', paidAmount: null, paidAt: null };
    teacher.salaryStatus = 'Pending';
    saveCache('lms_teachers', AppState.teachers);
    const ok = await dbSaveTeacher(teacher);
    renderApp();
    if (ok) showToastNotification(`Salary reverted to Pending for ${teacher.name}`);
    else showToastNotification(`Could not save to cloud: ${firestoreSyncError || 'Firestore is not available'} — saved on this device only.`, 'error');
  } else {
    teacher.payrollMonths[monthKey] = {
      status: 'Paid',
      bonus: calc.bonus,
      basicExtra: calc.basicExtra,
      allowance: calc.allowance,
      deduction: calc.deduction,
      paidAmount: calc.netPayable,
      paidAt: new Date().toISOString()
    };
    teacher.salaryStatus = 'Paid';
    saveCache('lms_teachers', AppState.teachers);
    const ok = await dbSaveTeacher(teacher);
    renderApp();
    if (ok) showToastNotification(`✓ Salary of ${formatPKR(calc.netPayable)} marked as Paid for ${teacher.name}`);
    else showToastNotification(`Could not save to cloud: ${firestoreSyncError || 'Firestore is not available'} — saved on this device only.`, 'error');
  }
}
window.toggleTeacherSalaryStatus = toggleTeacherSalaryStatus;

// ==========================================
// 8. TEACHER PAYROLL VIEW
// ==========================================

function renderAdminTeacherPayrollView() {
  // Lazy-load the global payroll rules from Firestore on first payroll
  // visit (local cache + defaults meanwhile). Re-renders when they arrive.
  if (!payrollSettingsLoaded && !payrollSettingsLoading) {
    payrollSettingsLoading = true;
    loadPayrollSettings().catch(() => {}).finally(() => {
      payrollSettingsLoaded = true;
      payrollSettingsLoading = false;
      renderApp();
    });
  }
  const monthLabel = `${MONTHS_LIST[CURRENT_MONTH_INDEX]} ${CURRENT_YEAR}`;
  const teachers = AppState.teachers || [];

  // KPI totals for the displayed month (Paid months use their recorded
  // snapshot; Pending months use the live formula).
  let totalPayroll = 0;
  let paidPayroll = 0;
  let pendingPayroll = 0;
  let paidCount = 0;
  let pendingCount = 0;
  teachers.forEach(t => {
    const c = computeTeacherPayroll(t);
    totalPayroll += c.netPayable;
    if (c.isPaid) { paidPayroll += c.netPayable; paidCount++; }
    else { pendingPayroll += c.netPayable; pendingCount++; }
  });

  // One filtered list shared by the desktop table and the mobile cards.
  let displayedTeachers = teachers.slice();
  if (AppState.teacherPayrollSalaryFilter && AppState.teacherPayrollSalaryFilter !== 'all') {
    displayedTeachers = displayedTeachers.filter(t => (computeTeacherPayroll(t).isPaid ? 'Paid' : 'Pending') === AppState.teacherPayrollSalaryFilter);
  }
  if (AppState.teacherPayrollSearchQuery && AppState.teacherPayrollSearchQuery.trim() !== '') {
    const q = AppState.teacherPayrollSearchQuery.trim().toLowerCase();
    displayedTeachers = displayedTeachers.filter(t =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.id || '').toLowerCase().includes(q)
    );
  }
  const isFiltered = (AppState.teacherPayrollSalaryFilter && AppState.teacherPayrollSalaryFilter !== 'all') ||
    AppState.teacherPayrollSearchQuery;

  const emptyStateHtml = renderSharedEmptyState({
    icon: 'teacher',
    title: isFiltered ? 'No faculty members match your filter criteria' : 'No faculty members registered yet',
    description: isFiltered ? 'Try adjusting your salary filter settings.' : 'Onboard your first teacher to start assigning classes and tracking payroll.',
    actionText: isFiltered ? 'Reset Filters' : '+ Add Faculty Member',
    actionFn: isFiltered ? 'resetTeacherPayrollFilters()' : 'openAddTeacherModal()'
  });

  const rowsHtml = displayedTeachers.length === 0 ? `
    <tr>
      <td colspan="9" class="py-12 text-center">${emptyStateHtml}</td>
    </tr>
  ` : displayedTeachers.map(t => {
    const c = computeTeacherPayroll(t);
    const isPaid = c.isPaid;
    const bonusCell = isPaid
      ? `<span class="font-semibold text-[#141F1E] tabular-nums">${formatPKR(c.bonus)}</span>`
      : `<span class="inline-flex items-center gap-1">
           <span class="text-[#7A8684] text-[11px]">Rs.</span>
           <input type="number" min="0" step="any" value="${c.bonus}"
             onchange="handleTeacherBonusChange('${t.id}', this)"
             class="w-20 bg-[#F8F6F1] border border-[#ECEAE4] rounded-lg h-8 px-2 text-xs font-bold text-[#141F1E] tabular-nums outline-none focus:border-[#0E4D45] focus:bg-white"
             title="Manual bonus for ${monthLabel} (PKR)" />
         </span>`;
    return `
      <tr class="hover:bg-[#F8F6F1]/50 transition-colors">
        <td class="py-3.5 font-bold text-[#141F1E]" data-label="Teacher">
          <div class="flex items-center gap-2">
            <img
              src="${t.avatar ? (t.avatar.includes('ui-avatars.com') ? getAvatarUrl(t.name) : t.avatar) : getAvatarUrl(t.name)}"
              alt="${t.name}"
              class="w-7 h-7 rounded-full object-cover shrink-0 ring-1 ring-[#0E4D45]/20"
              onerror="this.onerror=null; this.src='${getAvatarUrl(t.name)}';"
            />
            <span class="cursor-pointer hover:text-[#0E4D45] hover:underline" onclick="openEditTeacherModal('${t.id}')" title="Edit Teacher">${t.name}</span>
          </div>
        </td>
        <td class="py-3.5 font-semibold text-[#0E4D45] tabular-nums" data-label="Student Units">${formatPayrollUnits(c.units)} units</td>
        <td class="py-3.5 text-[#141F1E] font-medium tabular-nums" data-label="Basic + Extra">${formatPKR(c.basicExtra)}</td>
        <td class="py-3.5 text-[#141F1E] tabular-nums" data-label="Allowance">${formatPKR(c.allowance)}</td>
        <td class="py-3.5 text-[#141F1E] tabular-nums" data-label="Deduction">${formatPKR(c.deduction)}</td>
        <td class="py-3.5" data-label="Bonus">${bonusCell}</td>
        <td class="py-3.5 font-bold text-[#0E4D45] tabular-nums" data-label="Net Payable">${formatPKR(c.netPayable)}</td>
        <td class="py-3.5 text-center" data-label="Status">
          <span class="ts-badge ${isPaid ? 'ts-badge-paid' : 'ts-badge-partial'}">
            ${isPaid ? 'Paid' : 'Pending'}
          </span>
        </td>
        <td class="py-3.5 text-right pl-2" data-label="Action">
          <div class="flex items-center justify-end gap-1.5 whitespace-nowrap">
            <button onclick="openEditTeacherModal('${t.id}')"
              class="px-3 py-1 text-[11px] font-semibold rounded-lg bg-white border border-[#ECEAE4] text-[#141F1E] hover:bg-[#F8F6F1] hover:border-[#0E4D45] hover:text-[#0E4D45] transition-colors whitespace-nowrap cursor-pointer"
              title="Edit Teacher">
              Edit
            </button>
            <button onclick="toggleTeacherSalaryStatus('${t.id}')"
              class="px-3 py-1 text-[11px] font-semibold rounded-lg ${isPaid ? 'bg-[#E8EFEE] text-[#0E4D45] hover:bg-[#FEE2E2] hover:text-[#991B1B]' : 'bg-[#0E4D45] text-white hover:bg-[#14534B]'} transition-colors whitespace-nowrap shadow-2xs cursor-pointer">
              ${isPaid ? 'Mark Pending' : 'Pay Salary'}
            </button>
            <button onclick="deleteTeacher('${t.id}', event)"
              class="p-1.5 rounded-lg text-[#DC2626] hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer border border-transparent hover:border-red-200"
              title="Delete Faculty Member">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const cardsHtml = displayedTeachers.length === 0 ? `
    <div class="py-6 text-center">${emptyStateHtml}</div>
  ` : displayedTeachers.map(t => {
    const c = computeTeacherPayroll(t);
    const isPaid = c.isPaid;
    const bonusRow = isPaid
      ? `<div class="flex items-center justify-between mt-3 pt-3 border-t border-[#F8F6F1]">
           <span class="text-[11px] font-semibold text-[#7A8684]">Bonus (Paid)</span>
           <span class="text-xs font-bold text-[#141F1E] tabular-nums">${formatPKR(c.bonus)}</span>
         </div>`
      : `<div class="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-[#F8F6F1]">
           <label class="text-[11px] font-bold text-[#0E4D45] whitespace-nowrap">+ Add Bonus</label>
           <span class="inline-flex items-center gap-1">
             <span class="text-[#7A8684] text-[11px]">Rs.</span>
             <input type="number" min="0" step="any" value="${c.bonus}"
               onchange="handleTeacherBonusChange('${t.id}', this)"
               class="w-24 bg-[#F8F6F1] border border-[#ECEAE4] rounded-lg h-9 px-2.5 text-xs font-bold text-[#141F1E] tabular-nums outline-none focus:border-[#0E4D45] focus:bg-white"
               title="Manual bonus for ${monthLabel} (PKR)" />
           </span>
         </div>`;
    return `
      <div class="bg-white border border-[#ECEAE4] rounded-2xl p-4 shadow-xs">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <img
              src="${t.avatar ? (t.avatar.includes('ui-avatars.com') ? getAvatarUrl(t.name) : t.avatar) : getAvatarUrl(t.name)}"
              alt="${t.name}"
              class="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-[#0E4D45]/20"
              onerror="this.onerror=null; this.src='${getAvatarUrl(t.name)}';"
            />
            <div class="min-w-0">
              <p class="text-sm font-bold text-[#141F1E] truncate cursor-pointer hover:text-[#0E4D45]" onclick="openEditTeacherModal('${t.id}')" title="Edit Teacher">${t.name}</p>
              <p class="text-[11px] text-[#7A8684]">${c.activeCount} Active Student${c.activeCount === 1 ? '' : 's'} • ${formatPayrollUnits(c.units)} units</p>
            </div>
          </div>
          <span class="ts-badge ${isPaid ? 'ts-badge-paid' : 'ts-badge-partial'} shrink-0">${isPaid ? 'Paid' : 'Pending'}</span>
        </div>
        <p class="mt-3 text-[11px] font-semibold text-[#7A8684]">Net Payable • ${monthLabel}</p>
        <p class="text-2xl font-bold text-[#0E4D45] tabular-nums">${formatPKR(c.netPayable)}</p>
        <div class="mt-3 grid grid-cols-4 gap-2 rounded-xl bg-[#F8F6F1] border border-[#ECEAE4] px-2 py-2.5 text-center">
          <div class="min-w-0">
            <p class="text-[10px] font-semibold text-[#7A8684]">Units</p>
            <p class="text-[11px] font-bold text-[#141F1E] tabular-nums truncate" title="${formatPayrollUnits(c.units)} units">${formatPayrollUnits(c.units)}</p>
          </div>
          <div class="min-w-0">
            <p class="text-[10px] font-semibold text-[#7A8684]">Basic+Extra</p>
            <p class="text-[11px] font-bold text-[#141F1E] tabular-nums truncate" title="${formatPKR(c.basicExtra)}">${formatPKR(c.basicExtra)}</p>
          </div>
          <div class="min-w-0">
            <p class="text-[10px] font-semibold text-[#7A8684]">Allow</p>
            <p class="text-[11px] font-bold text-[#141F1E] tabular-nums truncate" title="${formatPKR(c.allowance)}">${formatPKR(c.allowance)}</p>
          </div>
          <div class="min-w-0">
            <p class="text-[10px] font-semibold text-[#7A8684]">Deduct</p>
            <p class="text-[11px] font-bold text-[#141F1E] tabular-nums truncate" title="${formatPKR(c.deduction)}">${formatPKR(c.deduction)}</p>
          </div>
        </div>
        ${bonusRow}
        <div class="mt-3 flex items-center gap-2">
          <button onclick="toggleTeacherSalaryStatus('${t.id}')"
            class="flex-1 px-3 py-2 text-xs font-bold rounded-lg ${isPaid ? 'bg-[#E8EFEE] text-[#0E4D45] hover:bg-[#FEE2E2] hover:text-[#991B1B]' : 'bg-[#0E4D45] text-white hover:bg-[#14534B]'} transition-colors cursor-pointer">
            ${isPaid ? 'Mark Pending' : 'Pay Salary'}
          </button>
          <button onclick="openEditTeacherModal('${t.id}')"
            class="px-3 py-2 text-xs font-semibold rounded-lg bg-white border border-[#ECEAE4] text-[#141F1E] hover:bg-[#F8F6F1] hover:border-[#0E4D45] hover:text-[#0E4D45] transition-colors cursor-pointer">
            Edit
          </button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="ts-card p-3.5 sm:p-6 mb-8 overflow-hidden">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#ECEAE4]">
        <div>
          <h2 class="text-xl font-bold text-[#141F1E]">Teacher Payroll</h2>
          <p class="text-xs text-[#7A8684] mt-1">Net payable salary in PKR — Basic Salary + extra student units, allowance, bonus and deduction.</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button onclick="openPayrollSettingsModal()" class="px-4 py-2.5 rounded-full bg-white border border-[#0E4D45] text-[#0E4D45] text-xs font-bold hover:bg-[#E8EFEE] transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer" title="Edit global payroll rules">
            <span>Payroll Settings ⚙️</span>
          </button>
          <button onclick="openAddTeacherModal()" class="px-5 py-2.5 rounded-full bg-[#0E4D45] text-white text-xs font-bold hover:bg-[#14534B] transition-all shadow-sm flex items-center gap-2 whitespace-nowrap cursor-pointer">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
            <span>+ Add Teacher</span>
          </button>
        </div>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="p-4 bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4]">
          <span class="text-xs text-[#7A8684] font-medium">Teachers</span>
          <p class="text-2xl font-bold text-[#141F1E] mt-1">${teachers.length} Teachers</p>
          <div class="flex items-center gap-1.5 mt-1">
            <span class="text-[11px] text-[#0E4D45] font-medium">Out of ${teachers.length} total faculty members</span>
          </div>
        </div>
        <div class="p-4 bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4]">
          <span class="text-xs text-[#7A8684] font-medium">Estimated Payroll (${monthLabel})</span>
          <p class="text-2xl font-bold text-[#0E4D45] mt-1">${formatPKR(totalPayroll)}</p>
          <div class="flex items-center gap-1.5 mt-1">
            <span class="text-[11px] text-[#0E4D45] font-medium">${paidCount} paid • ${pendingCount} pending</span>
          </div>
        </div>
        <div class="p-4 bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4]">
          <span class="text-xs text-[#7A8684] font-medium">Paid (${monthLabel})</span>
          <p class="text-2xl font-bold text-[#065F46] mt-1">${formatPKR(paidPayroll)}</p>
          <div class="flex items-center gap-1.5 mt-1">
            <span class="text-[11px] text-[#065F46] font-semibold">${paidCount} teacher${paidCount === 1 ? '' : 's'} paid</span>
          </div>
        </div>
        <div class="p-4 bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4]">
          <span class="text-xs text-[#7A8684] font-medium">Pending (${monthLabel})</span>
          <p class="text-2xl font-bold text-[#991B1B] mt-1">${formatPKR(pendingPayroll)}</p>
          <div class="flex items-center gap-1.5 mt-1">
            <span class="text-[11px] text-[#991B1B] font-semibold">${pendingCount} teacher${pendingCount === 1 ? '' : 's'} pending</span>
          </div>
        </div>
      </div>

      <!-- Teacher Payroll Search & Advanced Filter Toolbar -->
      <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 mb-6 pb-4 border-b border-[#ECEAE4]">
        <div class="flex items-center gap-2 flex-wrap text-xs">
          <span class="text-[11px] font-semibold text-[#7A8684] shrink-0">Filter:</span>

          <!-- Salary Status Filter -->
          <select
            onchange="setTeacherPayrollSalaryFilter(this.value)"
            class="px-3 py-1.5 rounded-full border border-[#ECEAE4] bg-[#F8F6F1] text-xs font-semibold text-[#141F1E] focus:outline-none focus:border-[#0E4D45] cursor-pointer"
          >
            <option value="all">All Salary Statuses</option>
            <option value="Paid" ${AppState.teacherPayrollSalaryFilter === 'Paid' ? 'selected' : ''}>Paid</option>
            <option value="Pending" ${AppState.teacherPayrollSalaryFilter === 'Pending' ? 'selected' : ''}>Pending</option>
          </select>

          ${((AppState.teacherPayrollSalaryFilter && AppState.teacherPayrollSalaryFilter !== 'all') ||
             AppState.teacherPayrollSearchQuery) ? `
            <button type="button" onclick="resetTeacherPayrollFilters()" class="text-[11px] font-bold text-[#0E4D45] hover:underline cursor-pointer">
              Reset Filters
            </button>
          ` : ''}
        </div>

        <!-- Sleek Search Input -->
        <div class="relative w-full md:w-72">
          <span class="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-[#94A3B8]">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </span>
          <input
            type="text"
            id="teacher-payroll-search-input"
            value="${AppState.teacherPayrollSearchQuery || ''}"
            oninput="handleTeacherPayrollSearch(this.value)"
            placeholder="Search faculty..."
            class="w-full pl-10 pr-8 py-2 text-xs rounded-full border border-[#ECEAE4] bg-white text-[#141F1E] placeholder-[#94A3B8] focus:outline-none focus:border-[#0E4D45] focus:ring-1 focus:ring-[#0E4D45] transition-all shadow-2xs"
          />
          ${AppState.teacherPayrollSearchQuery ? `
            <button onclick="clearTeacherPayrollSearch()" class="absolute inset-y-0 right-0 flex items-center pr-3 text-[#94A3B8] hover:text-[#141F1E] cursor-pointer" title="Clear search">✕</button>
          ` : ''}
        </div>
      </div>

      <!-- Desktop table (hidden on mobile) -->
      <div class="hidden md:block overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[880px]">
          <thead>
            <tr class="border-b border-[#ECEAE4] text-[11px] font-semibold text-[#7A8684]">
              <th class="pb-3">Teacher Name</th>
              <th class="pb-3">Student Units</th>
              <th class="pb-3">Basic + Extra</th>
              <th class="pb-3">Allowance</th>
              <th class="pb-3">Deduction</th>
              <th class="pb-3">Bonus (Editable)</th>
              <th class="pb-3">Net Payable (PKR)</th>
              <th class="pb-3 text-center">Status</th>
              <th class="pb-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#ECEAE4] text-xs">
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <!-- Mobile stacked cards (max-width: 768px) -->
      <div class="md:hidden space-y-3">
        ${cardsHtml}
      </div>
    </div>
  `;
}


// ==========================================
// 8B. ADMIN TRIALS & ACADEMY NOTICES VIEW
// ==========================================

function renderAdminTrialsAndNoticesView() {
  const pendingTrialsCount = TRIAL_PIPELINE.filter(t => t.status !== 'Enrolled ✓').length;
  const enrolledTrialsCount = TRIAL_PIPELINE.filter(t => t.status === 'Enrolled ✓').length;

  return `
    <div class="space-y-6 mb-8">
      
      <!-- Top Title Bar -->
      <div class="p-6 bg-white rounded-2xl border border-[#ECEAE4] shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-3">
            <h2 class="text-xl font-bold text-[#141F1E]">Trials & Notices</h2>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#E8EFEE] text-[#0E4D45] border border-[#CBD5E1]">Admin Workspace</span>
          </div>
          <p class="text-xs text-[#7A8684] mt-1">
            Evaluate incoming trial candidates, assign certified teachers, and broadcast academy notices.
          </p>
        </div>
      </div>

      <!-- Quick Metrics Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="p-4 bg-white rounded-2xl border border-[#ECEAE4] shadow-xs">
          <span class="text-xs text-[#7A8684] font-medium">Pending Trials</span>
          <p class="text-2xl font-bold text-[#141F1E] mt-1">${pendingTrialsCount} Candidates Awaiting</p>
        </div>
        <div class="p-4 bg-white rounded-2xl border border-[#ECEAE4] shadow-xs">
          <span class="text-xs text-[#7A8684] font-medium">Enrolled Trials</span>
          <p class="text-2xl font-bold text-[#0E4D45] mt-1">${enrolledTrialsCount} Approved & Active</p>
        </div>
        <div class="p-4 bg-white rounded-2xl border border-[#ECEAE4] shadow-xs">
          <span class="text-xs text-[#7A8684] font-medium">Academy Broadcasts</span>
          <p class="text-2xl font-bold text-[#141F1E] mt-1">${ACADEMY_NOTICES.length} Active Notices</p>
        </div>
      </div>

      <!-- CARD 1: TRIAL ADMISSIONS PIPELINE -->
      <div class="bg-white rounded-2xl border border-[#ECEAE4] p-6 mb-8 shadow-xs">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-[#ECEAE4]">
          <div>
            <div class="flex items-center gap-2.5">
              <h3 class="text-base font-bold text-[#141F1E]">Trial Admissions Pipeline</h3>
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#E8EFEE] text-[#0E4D45]">
                ${TRIAL_PIPELINE.length} Total Registered
              </span>
            </div>
            <p class="text-xs text-[#7A8684] mt-0.5">Active trial candidates awaiting evaluation and enrollment.</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#F8F6F1] text-[#0E4D45] border border-[#ECEAE4]">
              <span class="w-1.5 h-1.5 rounded-full ${pendingTrialsCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'}"></span>
              ${pendingTrialsCount} Pending Review
            </span>
            <button onclick="openAddTrialModal()" class="px-3.5 py-1.5 rounded-full bg-[#0E4D45] text-white text-xs font-bold hover:bg-[#14534B] transition-all shadow-xs flex items-center gap-1.5 cursor-pointer">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
              <span>+ Add Trial</span>
            </button>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse min-w-0 md:min-w-[760px] responsive-table-cards">
            <thead>
              <tr class="border-b border-[#ECEAE4] text-[11px] font-semibold text-[#7A8684]">
                <th class="pb-3 pl-2">Candidate Student</th>
                <th class="pb-3">Location & Timezone</th>
                <th class="pb-3">Preferred Time Slot</th>
                <th class="pb-3">Assigned Faculty</th>
                <th class="pb-3">Trial Status</th>
                <th class="pb-3 pr-2 text-right">Approval Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#ECEAE4] text-xs">
              ${TRIAL_PIPELINE.length === 0 ? `
                <tr>
                  <td colspan="6" class="py-12 text-center bg-[#F8F6F1]/50">
                    <div class="max-w-xs mx-auto flex flex-col items-center">
                      <div class="w-10 h-10 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mb-2">
                        <svg class="w-5 h-5 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21c-2.676 0-5.216-.584-7.499-1.632Z"/></svg>
                      </div>
                      <p class="text-xs font-bold text-[#141F1E]">No pending trial candidates</p>
                      <p class="text-[11px] text-[#7A8684] mt-0.5">Incoming trial booking assessments will appear in this pipeline.</p>
                    </div>
                  </td>
                </tr>
              ` : TRIAL_PIPELINE.map(trial => {
                const isEnrolled = trial.status === 'Enrolled ✓';
                
                let statusPill = '';
                if (isEnrolled) {
                  statusPill = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-[#065F46] border border-emerald-200/60"><span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>Enrolled</span>`;
                } else if (trial.status === 'Trial Completed') {
                  statusPill = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200/60"><span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>Completed</span>`;
                } else if (trial.status === 'Pending Review') {
                  statusPill = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200/80"><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>Pending Review</span>`;
                } else {
                  statusPill = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200/60"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Trial Booked</span>`;
                }

                const teacher = AppState.teachers.find(t => t.name === trial.assignedTeacher);
                const teacherAvatar = teacher ? (teacher.avatar && !teacher.avatar.includes('ui-avatars.com') ? teacher.avatar : getAvatarUrl(trial.assignedTeacher)) : getAvatarUrl(trial.assignedTeacher);

                return `
                  <tr class="hover:bg-[#F8F6F1]/50 transition-colors">
                    <!-- Candidate Student with Circular Profile Photo / Avatar -->
                    <td class="py-3.5 pl-2" data-label="Candidate">
                      <div class="flex items-center gap-3">
                        <div class="relative w-10 h-10 shrink-0">
                          <img 
                            src="${trial.avatar || getAvatarUrl(trial.studentName)}" 
                            alt="${trial.studentName}" 
                            class="w-10 h-10 rounded-full object-cover border border-[#ECEAE4] bg-white shadow-2xs"
                            onerror="this.onerror=null; this.src='${getAvatarUrl(trial.studentName)}';"
                          />
                        </div>
                        <div>
                          <span class="font-bold text-[#141F1E] text-xs block leading-snug">${trial.studentName}</span>
                          <span class="text-[10px] text-[#7A8684] font-mono mt-0.5 block">${trial.id} • ${trial.date}</span>
                        </div>
                      </div>
                    </td>

                    <!-- Country & Timezone with Sleek SVG Icon -->
                    <td class="py-3.5" data-label="Location">
                      <div class="text-[#334E4B] font-medium flex items-center gap-1.5 text-xs">
                        <svg class="w-3.5 h-3.5 text-[#7A8684] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                        <span>${trial.country}</span>
                      </div>
                    </td>

                    <!-- Preferred Time Slot with Clock Icon -->
                    <td class="py-3.5" data-label="Time Slot">
                      <div class="text-[#141F1E] font-medium flex items-center gap-1.5 text-xs">
                        <svg class="w-3.5 h-3.5 text-[#7A8684] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        <span>${trial.preferredTime}</span>
                      </div>
                    </td>

                    <!-- Assigned Faculty -->
                    <td class="py-3.5" data-label="Faculty">
                      ${teacher ? `
                        <div class="flex items-center gap-2">
                          <img src="${teacherAvatar}" alt="${trial.assignedTeacher}" class="w-6 h-6 rounded-full object-cover border border-[#ECEAE4]" onerror="this.onerror=null; this.src='${getAvatarUrl(trial.assignedTeacher)}';" />
                          <span class="font-semibold text-[#0E4D45] text-xs">${trial.assignedTeacher}</span>
                        </div>
                      ` : `
                        <div class="flex items-center gap-1.5">
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                            Unassigned
                          </span>
                          <select onchange="handleAssignTeacherToTrial('${trial.id}', this.value)" class="text-[11px] bg-white border border-[#CBD5E1] rounded-lg px-2 py-0.5 text-[#0E4D45] font-semibold outline-none cursor-pointer">
                            <option value="">Assign Teacher...</option>
                            ${AppState.teachers.length > 0 ? AppState.teachers.map(t => `<option value="${t.name}">${t.name}</option>`).join('') : '<option value="" disabled>No Faculty Available</option>'}
                          </select>
                        </div>
                      `}
                    </td>

                    <!-- Trial Status -->
                    <td class="py-3.5" data-label="Status">
                      ${statusPill}
                    </td>

                    <!-- Approval Action -->
                    <td class="py-3.5 pr-2 text-right" data-label="Action">
                      ${isEnrolled ? `
                        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#E8EFEE] text-[#0E4D45] text-xs font-semibold border border-[#CBD5E1]/60">
                          <svg class="w-3.5 h-3.5 text-[#0E4D45]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                          <span>Active Student</span>
                        </span>
                      ` : `
                        <button onclick="approveTrialToStudent('${trial.id}')"
                          class="px-4 py-1.5 text-xs font-bold rounded-full bg-[#0E4D45] hover:bg-[#14534B] text-white transition-all shadow-xs whitespace-nowrap cursor-pointer inline-flex items-center gap-1.5">
                          <span>+</span>
                          <span>Approve & Enroll</span>
                        </button>
                      `}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- CARD 2: OFFICIAL ACADEMY NOTICES & BROADCASTS -->
      <div class="bg-white rounded-2xl border border-[#ECEAE4] p-6 mb-8 shadow-xs">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-[#ECEAE4]">
          <div>
            <div class="flex items-center gap-2.5">
              <h3 class="text-base font-bold text-[#141F1E]">Official Academy Notices & Broadcasts</h3>
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#E8EFEE] text-[#0E4D45]">
                ${ACADEMY_NOTICES.length} Active
              </span>
            </div>
            <p class="text-xs text-[#7A8684] mt-0.5">Publish and manage announcements displayed across Student, Parent, and Faculty portals.</p>
          </div>

          <button onclick="openPublishNoticeModal()" class="px-4 py-2 rounded-full bg-[#0E4D45] hover:bg-[#14534B] text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer self-start sm:self-auto">
            <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
            <span>Post Academy Notice</span>
          </button>
        </div>

        <div class="space-y-3.5">
          ${ACADEMY_NOTICES.length === 0 ? `
            <div class="text-center py-12 px-4 rounded-2xl bg-[#F8F6F1]/50 border border-dashed border-[#ECEAE4]">
              <div class="w-10 h-10 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mx-auto mb-2.5">
                <svg class="w-5 h-5 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.34 15.84c-.063.046-.114.105-.14.18l-1.99 5.7c-.238.683-.93 1.04-1.61.802a1.25 1.25 0 0 1-.802-1.61l1.455-4.172H5.25a2.25 2.25 0 0 1-2.25-2.25v-2.5a2.25 2.25 0 0 1 2.25-2.25h2.955l4.57-4.113A1.25 1.25 0 0 1 15 6.467v11.066a1.25 1.25 0 0 1-2.09.933l-2.57-2.626ZM19.5 12c0-2.3-1.25-4.31-3.12-5.38a.75.75 0 1 0-.76 1.3A4.75 4.75 0 0 1 18 12c0 1.63-.81 3.07-2.07 3.94a.75.75 0 1 0 .86 1.22A6.24 6.24 0 0 0 19.5 12Z"/></svg>
              </div>
              <p class="text-xs font-bold text-[#141F1E]">No published notices.</p>
              <p class="text-[11px] text-[#7A8684] mt-0.5">Click "+ Post Academy Notice" to broadcast your first official announcement.</p>
            </div>
          ` : ACADEMY_NOTICES.map(notice => {
            const isMenuOpen = AppState.activeNoticeActionMenuId === notice.id;

            // Determine badge color tone based on audience
            let audiencePill = 'bg-[#E8EFEE] text-[#0E4D45] border border-[#CBD5E1]';
            if (notice.audience.includes('Teachers') || notice.audience.includes('Faculty')) {
              audiencePill = 'bg-blue-50 text-blue-800 border border-blue-200/60';
            } else if (notice.audience.includes('Parents')) {
              audiencePill = 'bg-amber-50 text-amber-800 border border-amber-200/60';
            } else if (notice.audience.includes('Qiraat') || notice.audience.includes('Hifz')) {
              audiencePill = 'bg-slate-100 text-slate-700 border border-slate-200';
            }

            return `
              <div class="p-5 rounded-2xl bg-[#F8F6F1]/70 hover:bg-[#F8F6F1] border border-[#ECEAE4] transition-all group relative">
                <!-- Top Row: Title, Audience Pill, Metadata & Actions -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2.5">
                  <div class="flex items-center gap-2.5 flex-wrap">
                    <h4 class="text-[15px] font-bold text-[#141F1E] tracking-tight">${notice.title}</h4>
                    <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${audiencePill}">
                      ${notice.audience}
                    </span>
                  </div>
                  
                  <div class="flex items-center gap-3 self-end sm:self-center">
                    <div class="text-[11px] text-[#7A8684] flex items-center gap-1.5 whitespace-nowrap">
                      <span class="font-medium text-[#141F1E]">${notice.author}</span>
                      <span>•</span>
                      <span>${notice.date}</span>
                    </div>

                    <!-- Inline Action Buttons (Clean & Sleek) -->
                    <div class="flex items-center gap-1.5">
                      <button onclick="openPublishNoticeModal('${notice.id}')" 
                        class="px-2.5 py-1 rounded-lg bg-white hover:bg-[#E8EFEE] text-[#0E4D45] border border-[#CBD5E1] text-[11px] font-semibold transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
                        title="Edit Notice">
                        <svg class="w-3 h-3 text-[#0E4D45]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                        <span class="hidden sm:inline">Edit</span>
                      </button>
                      <button onclick="deleteNotice('${notice.id}', event)" 
                        class="px-2.5 py-1 rounded-lg bg-white hover:bg-red-50 text-[#DC2626] border border-[#CBD5E1] text-[11px] font-semibold transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
                        title="Delete Notice">
                        <svg class="w-3 h-3 text-[#DC2626]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        <span class="hidden sm:inline">Delete</span>
                      </button>
                    </div>

                    <!-- 3-Dots Action Popover (Matching Linear / Stripe Pattern) -->
                    <div class="relative notice-action-menu-container">
                      <button onclick="toggleNoticeActionMenu('${notice.id}', event)" 
                        class="w-7 h-7 rounded-full flex items-center justify-center text-[#7A8684] hover:text-[#141F1E] hover:bg-white transition-all cursor-pointer font-bold inline-flex border border-transparent hover:border-[#ECEAE4]" 
                        title="More actions">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                      </button>

                      ${isMenuOpen ? `
                        <div class="absolute right-0 top-8 rounded-2xl shadow-xl border border-[#ECEAE4] p-1.5 w-44 bg-white z-50 text-left animate-in fade-in zoom-in-95 duration-150">
                          <button onclick="closeNoticeActionMenu(); openPublishNoticeModal('${notice.id}')" class="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-[#141F1E] hover:bg-[#F8F6F1] transition-colors cursor-pointer whitespace-nowrap">
                            <svg class="w-3.5 h-3.5 text-[#0E4D45]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                            <span>Edit Notice</span>
                          </button>
                          <button onclick="deleteNotice('${notice.id}', event)" class="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-[#DC2626] hover:bg-red-50 transition-colors cursor-pointer whitespace-nowrap">
                            <svg class="w-3.5 h-3.5 text-[#DC2626]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                            <span>Delete Notice</span>
                          </button>
                        </div>
                      ` : ''}
                    </div>
                  </div>
                </div>

                <!-- Bottom Row: Notice Message Body -->
                <p class="text-xs text-[#334E4B] leading-relaxed mt-1 pr-6 font-normal">
                  ${notice.content}
                </p>
              </div>
            `;
          }).join('')}
        </div>
      </div>

    </div>
  `;
}

// ==========================================
// 9. MODULE 1: MANAGER PORTAL (MASKED PII)
// ==========================================

function renderManagerPortalView() {
  const activeNav = AppState.activeNav || 'manager-radar';
  if (activeNav === 'library') return renderQuranLibraryView();

  const headerBanner = `
    <!-- Top Manager Notice Banner -->
    <div class="p-4 bg-[#FFFFFF] rounded-2xl border border-[#ECEAE4] shadow-sm flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center flex-shrink-0">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
        </div>
        <div>
          <h3 class="text-sm font-bold text-[#141F1E]">Manager Portal: Strict Student Privacy Protection Active</h3>
          <p class="text-xs text-[#7A8684]">
            Personal Identifiable Information (phone, email, exact fees) is masked. Use the automated "Send System Reminder" button to dispatch notifications via Academy Gateway.
          </p>
        </div>
      </div>
      <span class="ts-badge ts-badge-paid">Admin Lock Active</span>
    </div>
  `;

  let bodyContent = '';

  if (activeNav === 'manager-trials') {
    bodyContent = `
      <!-- Trial Classes Pipeline Card -->
      <div class="bg-white rounded-2xl border border-[#ECEAE4] p-6 shadow-xs">
        <div class="flex items-center justify-between mb-4 pb-3 border-b border-[#ECEAE4]">
          <div>
            <div class="flex items-center gap-2.5">
              <h3 class="text-base font-bold text-[#141F1E]">Trial Class Admissions Pipeline</h3>
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#E8EFEE] text-[#0E4D45]">
                ${TRIAL_PIPELINE.length} Active Trials
              </span>
            </div>
            <p class="text-xs text-[#7A8684] mt-0.5">Active trial candidates awaiting evaluation and enrollment.</p>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse min-w-0 md:min-w-[700px] responsive-table-cards">
            <thead>
              <tr class="border-b border-[#ECEAE4] text-[11px] font-semibold text-[#7A8684]">
                <th class="pb-3 pl-2">Candidate Student</th>
                <th class="pb-3">Location & Timezone</th>
                <th class="pb-3">Preferred Time</th>
                <th class="pb-3">Assigned Teacher</th>
                <th class="pb-3">Trial Status</th>
                <th class="pb-3 pr-2 text-right">Enrollment Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#ECEAE4] text-xs">
              ${TRIAL_PIPELINE.length === 0 ? `
                <tr>
                  <td colspan="6" class="py-12 text-center bg-[#F8F6F1]/50">
                    <div class="max-w-xs mx-auto flex flex-col items-center">
                      <div class="w-10 h-10 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mb-2">
                        <svg class="w-5 h-5 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21c-2.676 0-5.216-.584-7.499-1.632Z"/></svg>
                      </div>
                      <p class="text-xs font-bold text-[#141F1E]">No pending trial candidates</p>
                      <p class="text-[11px] text-[#7A8684] mt-0.5">Incoming trial booking assessments will appear in this pipeline.</p>
                    </div>
                  </td>
                </tr>
              ` : TRIAL_PIPELINE.map(trial => {
                const isEnrolled = trial.status === 'Enrolled ✓';
                
                let statusPill = '';
                if (isEnrolled) {
                  statusPill = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-[#065F46] border border-emerald-200/60"><span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>Enrolled</span>`;
                } else if (trial.status === 'Trial Completed') {
                  statusPill = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200/60"><span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>Completed</span>`;
                } else if (trial.status === 'Pending Review') {
                  statusPill = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200/80"><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>Pending Review</span>`;
                } else {
                  statusPill = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200/60"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Trial Booked</span>`;
                }

                return `
                  <tr class="hover:bg-[#F8F6F1]/50 transition-colors">
                    <td class="py-3.5 pl-2" data-label="Candidate">
                      <div class="flex items-center gap-3">
                        <div class="relative w-10 h-10 shrink-0">
                          <img 
                            src="${trial.avatar || getAvatarUrl(trial.studentName)}" 
                            alt="${trial.studentName}" 
                            class="w-10 h-10 rounded-full object-cover border border-[#ECEAE4] bg-white shadow-2xs"
                            onerror="this.onerror=null; this.src='${getAvatarUrl(trial.studentName)}';"
                          />
                        </div>
                        <div>
                          <span class="font-bold text-[#141F1E] text-xs block leading-snug">${trial.studentName}</span>
                          <span class="text-[10px] text-[#7A8684] font-mono mt-0.5 block">${trial.id} • ${trial.date}</span>
                        </div>
                      </div>
                    </td>
                    <td class="py-3.5 text-[#334E4B]" data-label="Location">${trial.country}</td>
                    <td class="py-3.5 text-[#7A8684] font-medium" data-label="Time">${trial.preferredTime}</td>
                    <td class="py-3.5 font-semibold text-[#0E4D45]" data-label="Teacher">${trial.assignedTeacher}</td>
                    <td class="py-3.5" data-label="Status">
                      ${statusPill}
                    </td>
                    <td class="py-3.5 pr-2 text-right" data-label="Action">
                      ${isEnrolled ? `
                        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#E8EFEE] text-[#0E4D45] text-xs font-semibold border border-[#CBD5E1]/60">
                          <svg class="w-3.5 h-3.5 text-[#0E4D45]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                          <span>Active Student</span>
                        </span>
                      ` : `
                        <button onclick="approveTrialToStudent('${trial.id}')"
                          class="px-4 py-1.5 text-xs font-bold rounded-full bg-[#0E4D45] text-white hover:bg-[#14534B] transition-colors shadow-xs whitespace-nowrap cursor-pointer">
                          + Approve & Enroll
                        </button>
                      `}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (activeNav === 'manager-substitute') {
    bodyContent = `
      <!-- Substitute Teacher Dispatch Panel -->
      <div class="ts-card p-6">
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#ECEAE4]">
          <div>
            <h3 class="text-base font-bold text-[#141F1E]">2-Click Substitute Teacher Dispatch</h3>
            <p class="text-xs text-[#7A8684]">Reassign live or upcoming classes immediately when a teacher is on emergency leave.</p>
          </div>
          <button onclick="openSubstituteModal()" class="px-5 py-2.5 rounded-full bg-[#0E4D45] text-white text-xs font-bold hover:bg-[#14534B] transition-colors shadow-sm flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
            <span>Launch Substitute Modal</span>
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${AppState.teachers.length > 0 ? AppState.teachers.map(t => `
            <div class="p-4 rounded-2xl border border-[#ECEAE4] bg-[#F8F6F1]/50 flex items-center justify-between">
              <div>
                <h4 class="text-xs font-bold text-[#141F1E]">${t.name}</h4>
                <p class="text-[11px] text-[#7A8684]">${t.country}</p>
                <div class="flex items-center gap-2 mt-2">
                  <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span class="text-[10px] text-[#065F46] font-semibold">Available for On-Demand Cover</span>
                </div>
              </div>
              <button onclick="openSubstituteModal()" class="px-3 py-1.5 text-xs font-bold rounded-full bg-[#FFFFFF] border border-[#ECEAE4] text-[#0E4D45] hover:bg-[#0E4D45] hover:text-white transition-all shadow-sm">
                Assign Cover
              </button>
            </div>
          `).join('') : `
            <div class="col-span-full p-6 rounded-2xl border border-[#ECEAE4] bg-[#F8F6F1] text-center text-xs text-[#7A8684]">
              No certified faculty registered for substitute coverage.
            </div>
          `}
        </div>
      </div>
    `;
  } else if (activeNav === 'manager-students') {
    bodyContent = `
      <!-- Masked Student Roster with 1-Click System Reminder -->
      <div class="ts-card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-base font-bold text-[#141F1E]">Assigned Student Roster (Masked PII)</h3>
            <p class="text-xs text-[#7A8684]">Dispatch automated reminders without viewing parent phone numbers</p>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse min-w-0 md:min-w-[750px] responsive-table-cards">
            <thead>
              <tr class="border-b border-[#ECEAE4] text-[11px] font-semibold text-[#7A8684]">
                <th class="pb-3">Student Token</th>
                <th class="pb-3">Guardian</th>
                <th class="pb-3">Contact Details</th>
                <th class="pb-3">Course Track</th>
                <th class="pb-3">Fee Status</th>
                <th class="pb-3 text-right">System Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#ECEAE4] text-xs">
              ${AppState.students.map(s => {
                const display = getStudentDisplay(s, 'manager');
                const feeStatus = getStudentFeeStatus(s);
                return `
                  <tr class="hover:bg-[#F8F6F1]/50 transition-colors">
                    <td class="py-3.5" data-label="Student Token">
                      <div class="font-bold text-[#141F1E]">${display.displayName}</div>
                      <div class="text-[11px] text-[#7A8684]">${s.timezone}</div>
                    </td>
                    <td class="py-3.5 text-[#7A8684] font-medium" data-label="Guardian">
                      <span class="px-2 py-0.5 rounded bg-[#ECEAE4] text-[11px]">${display.guardianDisplay}</span>
                    </td>
                    <td class="py-3.5 text-[#7A8684]" data-label="Contact">
                      <span class="px-2 py-0.5 rounded bg-[#ECEAE4] text-[11px]">${display.phoneDisplay}</span>
                    </td>
                    <td class="py-3.5 text-[#334E4B] font-medium" data-label="Course Track">${s.course}</td>
                    <td class="py-3.5" data-label="Fee Status">
                      ${renderStudentLedgerStatusPill(s)}
                    </td>
                    <td class="py-3.5 text-right" data-label="Action">
                      <button onclick="triggerSystemReminder('${s.id}')" class="px-3 py-1.5 text-xs font-bold rounded-full bg-[#0E4D45] text-white hover:bg-[#14534B] transition-colors">
                        Send System Reminder
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else {
    // Default: manager-radar
    bodyContent = `
      <!-- Live Classes Radar Card -->
      <div class="ts-card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-base font-bold text-[#141F1E]">Live Classes Radar</h3>
            <p class="text-xs text-[#7A8684]">Real-time teacher presence and audio/video connectivity monitor</p>
          </div>
          <button onclick="openSubstituteModal()" class="px-4 py-2 text-xs font-bold rounded-full bg-[#0E4D45] text-white hover:bg-[#14534B] transition-colors">
            Assign Substitute Teacher
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${LIVE_CLASSES_RADAR.map(c => `
            <div class="p-4 rounded-2xl border border-[#ECEAE4] bg-[#F8F6F1]/50 flex items-center justify-between">
              <div>
                <div class="flex items-center gap-2 mb-1">
                  <span class="font-bold text-xs text-[#141F1E]">${c.course}</span>
                  <span class="ts-badge ts-badge-paid">${c.status}</span>
                </div>
                <p class="text-[11px] text-[#0E4D45] font-semibold">${c.teacherName}</p>
                <p class="text-[11px] text-[#7A8684] mt-0.5">Student: <span class="font-medium text-[#141F1E]">${c.studentMasked}</span></p>
                <div class="flex items-center gap-3 mt-2 text-[10px] text-[#334E4B]">
                  <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> ${c.audio}</span>
                  <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> ${c.video}</span>
                  <span class="flex items-center gap-1">
                    <svg class="w-3 h-3 text-[#7A8684]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
                    <span>${c.time}</span>
                  </span>
                </div>
              </div>
              <button onclick="simulateJoinRoom('${c.id}')" class="px-3 py-1.5 text-xs font-bold rounded-full bg-[#FFFFFF] border border-[#ECEAE4] text-[#0E4D45] hover:bg-[#0E4D45] hover:text-white transition-all shadow-sm">
                Monitor Class
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  return `
    <div class="space-y-6 mb-8">
      ${headerBanner}
      ${bodyContent}
    </div>
  `;
}

// ==========================================
// 10. MODULE 3: TEACHER PORTAL (30-SEC ZERO-TYPING WORKFLOW)
// ==========================================

function renderTeacherPortalView() {
  const currentTeacher = AppState.teachers[0] || null;
  const activeNav = AppState.activeNav || 'teacher-schedule';
  if (activeNav === 'library') return renderQuranLibraryView();

  if (!currentTeacher) {
    return `
      <div class="max-w-2xl mx-auto py-16 text-center mb-8 bg-white p-8 rounded-2xl border border-[#ECEAE4] shadow-xs">
        <div class="w-14 h-14 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mx-auto mb-3">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5"/></svg>
        </div>
        <h3 class="text-base font-bold text-[#141F1E]">No Faculty Profiles Onboarded</h3>
        <p class="text-xs text-[#7A8684] mt-1 max-w-sm mx-auto">Switch back to Admin view to onboard certified Quran teachers into the academy.</p>
        <button onclick="setRole('admin')" class="mt-4 px-5 py-2 text-xs font-bold rounded-full bg-[#0E4D45] text-white hover:bg-[#14534B] shadow-sm cursor-pointer">
          Return to Admin Portal
        </button>
      </div>
    `;
  }

  const headerBanner = `
    <!-- Greeting & Schedule Summary -->
    <div class="p-6 bg-[#FFFFFF] rounded-2xl border border-[#ECEAE4] shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          <h2 class="text-xl font-bold text-[#141F1E]">Assalam-o-Alaikum, ${currentTeacher.name}</h2>
          <span class="ts-badge ts-badge-paid">Teacher Portal</span>
        </div>
        <p class="text-xs text-[#7A8684] mt-1">
          Student PII is locked for privacy. Log Sabaq in 30 seconds using zero-typing pills.
        </p>
      </div>
      <button onclick="openSabaqLoggerModal()" class="px-5 py-2.5 text-xs font-bold rounded-full bg-[#0E4D45] text-white hover:bg-[#14534B] transition-colors shadow-sm flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
        <span>Open 30-Sec Sabaq Logger</span>
      </button>
    </div>
  `;

  let bodyContent = '';

  if (activeNav === 'teacher-logger') {
    bodyContent = `
      <!-- 30-Sec Fast Sabaq Logger Hub -->
      <div class="ts-card p-6">
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#ECEAE4]">
          <div>
            <h3 class="text-base font-bold text-[#141F1E]">Rapid Zero-Typing Sabaq Logger</h3>
            <p class="text-xs text-[#7A8684]">Log Sabaq, Sabqi, and Manzil in under 30 seconds using one-tap pills</p>
          </div>
          <button onclick="openSabaqLoggerModal()" class="px-5 py-2.5 text-xs font-bold rounded-full bg-[#0E4D45] text-white hover:bg-[#14534B] transition-colors shadow-sm flex items-center gap-2">
            <span>+ Log New Lesson</span>
          </button>
        </div>

        <div class="space-y-4">
          <h4 class="text-xs font-bold text-[#7A8684] uppercase tracking-wider">Recent Sabaq Submissions</h4>
          ${AppState.students.filter(s => s.lastSabaq).map(s => {
            const display = getStudentDisplay(s, 'teacher');
            return `
              <div class="p-4 rounded-2xl bg-[#F8F6F1] border border-[#ECEAE4] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div class="flex items-center gap-2 mb-1">
                    <span class="font-bold text-xs text-[#141F1E]">${display.displayName}</span>
                    <span class="ts-badge ts-badge-paid">${s.lastSabaq.date}</span>
                    <span class="ts-badge ts-badge-sage">${s.lastSabaq.type}</span>
                  </div>
                  <p class="text-xs font-semibold text-[#0E4D45]">${s.lastSabaq.surah}</p>
                  <p class="text-[11px] text-[#334E4B] mt-1 italic">"${s.lastSabaq.teacherNote}"</p>
                  <div class="flex flex-wrap items-center gap-1.5 mt-2">
                    ${(s.lastSabaq.tags || []).map(tag => `
                      <span class="text-[10px] px-2 py-0.5 rounded-full bg-[#E8EFEE] text-[#0E4D45] font-semibold">${tag}</span>
                    `).join('')}
                  </div>
                </div>
                <div class="text-right flex flex-col items-end gap-2">
                  <div class="text-amber-500 font-bold text-sm">${'â­'.repeat(s.lastSabaq.rating || 5)}</div>
                  <button onclick="openSabaqLoggerModal('${s.id}')" class="px-3 py-1.5 text-xs font-bold rounded-full bg-[#FFFFFF] border border-[#ECEAE4] text-[#0E4D45] hover:bg-[#0E4D45] hover:text-white transition-all shadow-sm">
                    Re-log Lesson â†—
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  } else if (activeNav === 'teacher-my-students') {
    bodyContent = `
      <!-- My Enrolled Students Roster -->
      <div class="ts-card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-base font-bold text-[#141F1E]">My Assigned Students (Privacy Protected)</h3>
            <p class="text-xs text-[#7A8684]">Student contact PII is locked by Academy Admin policy</p>
          </div>
          <span class="ts-badge ts-badge-paid">${AppState.students.length} ${AppState.students.length === 1 ? 'Student' : 'Students'} Assigned</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse min-w-0 md:min-w-[700px] responsive-table-cards">
            <thead>
              <tr class="border-b border-[#ECEAE4] text-[11px] font-semibold text-[#7A8684]">
                <th class="pb-3">Student Token</th>
                <th class="pb-3">Course Track</th>
                <th class="pb-3">Current Lesson</th>
                <th class="pb-3">Last Rating</th>
                <th class="pb-3 text-right">Quick Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#ECEAE4] text-xs">
              ${AppState.students.map(s => {
                const display = getStudentDisplay(s, 'teacher');
                return `
                  <tr class="hover:bg-[#F8F6F1]/50 transition-colors">
                    <td class="py-3.5" data-label="Student Token">
                      <div class="font-bold text-[#141F1E]">${display.displayName}</div>
                      <div class="text-[11px] text-[#7A8684]">${s.timezone}</div>
                    </td>
                    <td class="py-3.5 text-[#334E4B] font-medium" data-label="Course Track">${s.course}</td>
                    <td class="py-3.5 text-[#0E4D45] font-semibold" data-label="Current Lesson">${s.lastSabaq ? s.lastSabaq.surah : 'First Lesson Pending'}</td>
                    <td class="py-3.5" data-label="Rating">
                      <div class="text-amber-500 font-bold">${'â­'.repeat(s.lastSabaq ? s.lastSabaq.rating : 5)}</div>
                    </td>
                    <td class="py-3.5 text-right pl-2" data-label="Action">
                      <button onclick="openSabaqLoggerModal('${s.id}')"
                        class="px-3 py-1 text-[11px] font-bold rounded-full bg-[#0E4D45] text-white hover:bg-[#14534B] transition-colors whitespace-nowrap shadow-sm">
                        Log Sabaq
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else {
    // Default: teacher-schedule
    bodyContent = `
      <!-- Today's Class Schedule -->
      <div class="ts-card p-6">
        <h3 class="text-base font-bold text-[#141F1E] mb-4">Today's Class Schedule</h3>
        
        <div class="space-y-3">
          <div class="p-4 rounded-2xl border border-[#ECEAE4] bg-[#F8F6F1]/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <img 
                src="${AppState.students.find(s => s.id === 'QA-1042')?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=faces'}" 
                alt="Ahmed Raza" 
                class="w-10 h-10 rounded-full object-cover shrink-0 border border-[#ECEAE4] shadow-2xs" 
                onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=Ahmed+Raza&background=0E4D45&color=fff';" 
              />
              <div>
                <h4 class="text-xs font-bold text-[#141F1E]">QA-1042 • Ahmed Raza (UK)</h4>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-[11px] text-[#7A8684]">Advanced Tajweed</span>
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#E8EFEE] text-[#0E4D45] text-[10px] font-medium border border-[#CBD5E1]">
                    10:00 AM BST ⇄ PKT 02:00 PM
                  </span>
                </div>
                <p class="text-[10px] text-[#065F46] font-semibold mt-0.5">Last Lesson: Surah Maryam Ayah 1-22 (Cleared)</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="openViewWeeklyScheduleModal('QA-1042')" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#ECEAE4] text-[#0E4D45] hover:bg-[#E8EFEE] transition-colors cursor-pointer shadow-2xs">
                <svg class="w-3.5 h-3.5 text-[#0E4D45]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                <span>Timetable</span>
              </button>
              <button onclick="simulateJoinRoom('C-201')" class="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#0E4D45] text-white hover:bg-[#14534B] transition-colors shadow-2xs cursor-pointer">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                <span>Start Class</span>
              </button>
              <button onclick="openSabaqLoggerModal('QA-1042')" class="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#FFFFFF] border border-[#ECEAE4] text-[#0E4D45] hover:bg-[#F8F6F1] transition-colors cursor-pointer">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                <span>Log Sabaq</span>
              </button>
            </div>
          </div>

          <div class="p-4 rounded-2xl border border-[#ECEAE4] bg-[#F8F6F1]/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <img 
                src="${AppState.students.find(s => s.id === 'QA-1008')?.avatar || 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=100&h=100&fit=crop&crop=faces'}" 
                alt="Tariq Mansoor" 
                class="w-10 h-10 rounded-full object-cover shrink-0 border border-[#ECEAE4] shadow-2xs" 
                onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=Tariq+Mansoor&background=0E4D45&color=fff';" 
              />
              <div>
                <h4 class="text-xs font-bold text-[#141F1E]">QA-1008 • Tariq Mansoor (USA)</h4>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-[11px] text-[#7A8684]">Hifz Juz 3</span>
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#E8EFEE] text-[#0E4D45] text-[10px] font-medium border border-[#CBD5E1]">
                    11:00 AM CST ⇄ PKT 09:00 PM
                  </span>
                </div>
                <p class="text-[10px] text-[#92400E] font-semibold mt-0.5">Last Lesson: Al-Baqarah 255-260 (Needs Revision)</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="openViewWeeklyScheduleModal('QA-1008')" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#ECEAE4] text-[#0E4D45] hover:bg-[#E8EFEE] transition-colors cursor-pointer shadow-2xs">
                <svg class="w-3.5 h-3.5 text-[#0E4D45]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                <span>Timetable</span>
              </button>
              <button onclick="simulateJoinRoom('C-202')" class="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#0E4D45] text-white hover:bg-[#14534B] transition-colors shadow-2xs cursor-pointer">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                <span>Start Class</span>
              </button>
              <button onclick="openSabaqLoggerModal('QA-1008')" class="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#FFFFFF] border border-[#ECEAE4] text-[#0E4D45] hover:bg-[#F8F6F1] transition-colors cursor-pointer">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                <span>Log Sabaq</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="space-y-6 mb-8">
      ${headerBanner}
      ${bodyContent}
    </div>
  `;
}

// ==========================================
// 11. MODULE 4: STUDENT / PARENT PORTAL
// ==========================================

function renderStudentParentPortalView() {
  if (!AppState.students || AppState.students.length === 0) {
    return `
      <div class="max-w-2xl mx-auto py-16 px-6 text-center mb-8">
        <div class="p-8 bg-white rounded-2xl border border-[#ECEAE4] shadow-xs">
          <div class="w-12 h-12 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mx-auto mb-3">
            <svg class="w-6 h-6 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21c-2.676 0-5.216-.584-7.499-1.632Z"/></svg>
          </div>
          <h3 class="text-base font-bold text-[#141F1E]">No Enrolled Student Profile</h3>
          <p class="text-xs text-[#7A8684] mt-1.5 mb-5">There are currently no active students enrolled in the system. Switch back to Admin to enroll students or register via Trial Admissions.</p>
          <button onclick="switchRole('admin')" class="px-5 py-2.5 rounded-full bg-[#0E4D45] hover:bg-[#14534B] text-white text-xs font-bold transition-all shadow-xs cursor-pointer">
            Return to Admin Dashboard
          </button>
        </div>
      </div>
    `;
  }
  if (AppState.activeNav === 'library') return renderQuranLibraryView();
  const activeStudent = AppState.students.find(s => s.id === AppState.selectedSiblingId) || AppState.students[0];
  const siblingStudents = AppState.students.filter(s => s.familyId === 'FAM-102');
  const feeStatus = getStudentFeeStatus(activeStudent);
  const balanceDue = getStudentBalanceDue(activeStudent);
  const activeNav = AppState.activeNav || 'student-portal';

  const headerBanner = `
    <!-- Top Sibling Switcher Header -->
    <div class="p-6 bg-[#FFFFFF] rounded-2xl border border-[#ECEAE4] shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div>
        <span class="text-xs text-[#7A8684] font-semibold">Guardian Portal: Dr. Tariq Khan (FAM-102)</span>
        <h2 class="text-xl font-bold text-[#141F1E] mt-0.5">${activeStudent.firstName}'s Learning Dashboard</h2>
      </div>

      <!-- Sibling Switcher Dropdown -->
      <div class="flex items-center gap-3">
        <span class="text-xs text-[#7A8684] font-medium">Switch Child:</span>
        <select onchange="switchSiblingChild(this.value)" class="text-xs bg-[#F8F6F1] border border-[#ECEAE4] rounded-full px-4 py-2 text-[#0E4D45] font-bold outline-none cursor-pointer">
          ${siblingStudents.map(sib => `
            <option value="${sib.id}" ${sib.id === activeStudent.id ? 'selected' : ''}>
              ${sib.firstName} Khan (${sib.course.split(' ')[0]})
            </option>
          `).join('')}
        </select>
      </div>
    </div>
  `;

  let bodyContent = '';

  if (activeNav === 'student-ledger') {
    bodyContent = `
      <!-- Transparent Fee Ledger for Parent -->
      <div class="ts-card p-6">
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#ECEAE4]">
          <div>
            <h3 class="text-base font-bold text-[#141F1E]">Tuition Ledger & 12-Month Matrix (${CURRENT_YEAR})</h3>
            <p class="text-xs text-[#7A8684]">Transparent breakdown of monthly dues, partial payments, and advance credits</p>
          </div>
          <div class="text-right">
            <span class="text-xs text-[#7A8684]">Current Outstanding Due</span>
            <p class="text-xl font-bold ${balanceDue > 0 ? 'text-[#991B1B]' : 'text-[#065F46]'}">
              ${balanceDue > 0 ? `${activeStudent.currency}${balanceDue} Due` : 'Fully Paid âœ“'}
            </p>
          </div>
        </div>

        <!-- 12 Month Grid for this student -->
        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2 mb-6">
          ${activeStudent.months.map(m => `
            <div class="month-cell ${m.status} p-2 text-center">
              <span class="font-bold">${m.month}</span>
              <span class="text-[9px] mt-0.5">
                ${m.status === 'paid' ? 'âœ“ Paid' : (m.status === 'partial' ? `Partial (${activeStudent.currency}${m.amountPaid})` : (m.status === 'advance' ? 'ADV' : (m.status === 'defaulter' ? 'Due' : '-')))}
              </span>
            </div>
          `).join('')}
        </div>

        <div class="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-[#ECEAE4]">
          <button onclick="openReceiptModal('TXN-9020')" class="px-4 py-2 text-xs font-bold rounded-full bg-[#FFFFFF] border border-[#ECEAE4] text-[#0E4D45] hover:bg-[#F8F6F1] transition-colors">
            View Last Official Receipt â†—
          </button>
          <button onclick="openReceiveFeeModal('${activeStudent.id}')" class="px-5 py-2 text-xs font-bold rounded-full bg-[#0E4D45] text-white hover:bg-[#14534B] transition-colors shadow-sm">
            Pay Tuition Online
          </button>
        </div>
      </div>
    `;
  } else if (activeNav === 'student-receipts') {
    const familyReceipts = PAYMENT_LEDGER.filter(t => t.studentId === activeStudent.id || t.studentId === 'QA-1021');
    const displayReceipts = familyReceipts.length > 0 ? familyReceipts : PAYMENT_LEDGER;

    bodyContent = `
      <!-- Official Receipts Panel -->
      <div class="ts-card p-6">
        <div class="flex items-center justify-between mb-4 pb-4 border-b border-[#ECEAE4]">
          <div>
            <h3 class="text-base font-bold text-[#141F1E]">Official Academy Receipts & Tax Invoices</h3>
            <p class="text-xs text-[#7A8684]">Verified payment documentation with downloadable and printable official seals</p>
          </div>
          <span class="ts-badge ts-badge-paid">${displayReceipts.length} Receipts Issued</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse min-w-0 md:min-w-[700px] responsive-table-cards">
            <thead>
              <tr class="border-b border-[#ECEAE4] text-[11px] font-semibold text-[#7A8684]">
                <th class="pb-3">Receipt / Invoice #</th>
                <th class="pb-3">Payment Date</th>
                <th class="pb-3">Allocated Session</th>
                <th class="pb-3">Method</th>
                <th class="pb-3 text-right">Amount Paid</th>
                <th class="pb-3 text-center">Status</th>
                <th class="pb-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#ECEAE4] text-xs">
              ${displayReceipts.map(rc => `
                <tr class="hover:bg-[#F8F6F1]/50 transition-colors">
                  <td class="py-3.5 font-bold text-[#141F1E]" data-label="Receipt #">${rc.id}</td>
                  <td class="py-3.5 text-[#7A8684]" data-label="Date">${rc.date}</td>
                  <td class="py-3.5 text-[#334E4B] font-medium" data-label="Allocated Session">${rc.allocatedTo}</td>
                  <td class="py-3.5 text-[#7A8684]" data-label="Method">${rc.method}</td>
                  <td class="py-3.5 text-right font-bold text-[#0E4D45]" data-label="Amount Paid">${rc.currency}${rc.amount}</td>
                  <td class="py-3.5 text-center" data-label="Status">
                    <span class="ts-badge ts-badge-paid">${rc.status}</span>
                  </td>
                  <td class="py-3.5 text-right pl-2" data-label="Action">
                    <button onclick="openReceiptModal('${rc.id}')"
                      class="px-3 py-1.5 text-xs font-bold rounded-full bg-[#FFFFFF] border border-[#ECEAE4] text-[#0E4D45] hover:bg-[#0E4D45] hover:text-white transition-all shadow-sm whitespace-nowrap">
                      Print / View Receipt ↗
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else {
    // Default: student-portal
    bodyContent = `
      <!-- Prominent "Join Live Class" Card -->
      <div class="p-6 rounded-3xl bg-[#0E4D45] text-white shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#236058] text-xs font-semibold mb-2">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Live Class Room Ready</span>
          </div>
          <h3 class="text-xl font-bold">${activeStudent.course}</h3>
          <p class="text-xs text-[#A3C2BE] mt-1">
            Teacher: Ustadh Bilal Tariq â€¢ Daily 30 min Live One-on-One Session
          </p>
        </div>
        <button onclick="simulateJoinRoom('C-201')" class="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#FFFFFF] text-[#0E4D45] font-bold text-sm hover:bg-[#F8F6F1] transition-all shadow-md">
          <svg class="w-4 h-4 text-[#0E4D45]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
          <span>Join Live Class</span>
        </button>
      </div>

      <!-- Daily Sabaq Progress Card -->
      <div class="ts-card p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-bold text-[#141F1E]">Latest Sabaq & Homework Progress</h3>
          <span class="ts-badge ts-badge-paid">${activeStudent.lastSabaq ? activeStudent.lastSabaq.date : 'Today'}</span>
        </div>

        <div class="p-4 rounded-2xl bg-[#F8F6F1] border border-[#ECEAE4]">
          <div class="flex items-start justify-between">
            <div>
              <span class="text-xs text-[#7A8684] uppercase font-bold tracking-wider">${activeStudent.lastSabaq ? activeStudent.lastSabaq.type : 'Daily Recitation'}</span>
              <h4 class="text-base font-bold text-[#141F1E] mt-0.5">${activeStudent.lastSabaq ? activeStudent.lastSabaq.surah : 'Surah Al-Fatiha'}</h4>
              <p class="text-xs text-[#334E4B] mt-2 italic">"${activeStudent.lastSabaq ? activeStudent.lastSabaq.teacherNote : 'Continuous improvement in Tajweed articulation rules.'}"</p>
            </div>
            <div class="text-right">
              <div class="text-base text-amber-500 font-bold">
                ${'â­'.repeat(activeStudent.lastSabaq ? activeStudent.lastSabaq.rating : 5)}
              </div>
              <span class="ts-badge ts-badge-sage mt-1">${activeStudent.lastSabaq ? activeStudent.lastSabaq.status : 'Cleared'}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="space-y-6 mb-8">
      ${headerBanner}
      ${bodyContent}
    </div>
  `;
}


function switchSiblingChild(studentId) {
  AppState.selectedSiblingId = studentId;
  renderApp();
}

// ==========================================
// 12. MODAL CONTROLLERS & INTERACTION HANDLERS
// ==========================================

/**
 * Populates the Target Academic Month selector inside Receive Tuition Fee modal
 * Defaults to current academic month (November 2026)
 */
function populateModalFeeMonthSelect(targetId = null, selectedMonthIdx = CURRENT_MONTH_INDEX) {
  const monthSelect = document.getElementById('modal-fee-month-select');
  if (!monthSelect) return;

  let html = '';
  MONTHS_LIST.forEach((m, idx) => {
    const isCurrent = idx === CURRENT_MONTH_INDEX;
    const isSelected = idx === selectedMonthIdx;
    const label = `${FULL_MONTHS_LIST[idx]} ${CURRENT_YEAR}${isCurrent ? ' (Current)' : ''}`;
    html += `<option value="${idx}" ${isSelected ? 'selected' : ''}>${label}</option>`;
  });
  monthSelect.innerHTML = html;
}
window.populateModalFeeMonthSelect = populateModalFeeMonthSelect;

/**
 * Dynamically updates quick settlement presets based on selected student or family
 * Fixes Bug 3: Presets use dynamic student monthly fee (${fee}, ${fee * 2}, Full Clear)
 */
function updateModalFeePresets(targetId) {
  const container = document.getElementById('modal-fee-presets-container');
  if (!container) return;

  let fee = 50;
  let balance = 0;
  let currency = '$';

  if (targetId && isFamilyTarget(targetId)) {
    const famStudents = (AppState.students || []).filter(s => s.familyId === targetId || s.familyTag === targetId);
    fee = famStudents.reduce((sum, s) => sum + (Number(s.monthlyFee) || 0), 0) || 50;
    balance = famStudents.reduce((sum, s) => sum + getStudentBalanceDue(s), 0);
    currency = famStudents[0]?.currency || '$';
  } else {
    const student = (AppState.students || []).find(s => s.id === targetId) || AppState.students[0];
    if (student) {
      fee = Number(student.monthlyFee) || 50;
      balance = getStudentBalanceDue(student);
      currency = student.currency || '$';
    }
  }

  const clearAmt = balance > 0 ? balance : fee;

  container.innerHTML = `
    <button type="button" onclick="setModalAmount(${fee})" class="px-2.5 py-1 rounded-full bg-[#F8F6F1] hover:bg-[#E8EFEE] text-[#0E4D45] text-[11px] font-bold border border-[#ECEAE4] transition-colors cursor-pointer shadow-2xs">
      1 Month (${currency}${fee})
    </button>
    <button type="button" onclick="setModalAmount(${fee * 2})" class="px-2.5 py-1 rounded-full bg-[#F8F6F1] hover:bg-[#E8EFEE] text-[#0E4D45] text-[11px] font-bold border border-[#ECEAE4] transition-colors cursor-pointer shadow-2xs">
      2 Months (${currency}${fee * 2})
    </button>
    <button type="button" onclick="setModalAmount('full')" class="px-2.5 py-1 rounded-full bg-[#F8F6F1] hover:bg-[#E8EFEE] text-[#0E4D45] text-[11px] font-bold border border-[#ECEAE4] transition-colors cursor-pointer shadow-2xs">
      Full Clear (${currency}${clearAmt})
    </button>
  `;
}
window.updateModalFeePresets = updateModalFeePresets;

function getNextPayableMonthIndex(targetId) {
  if (!targetId || isFamilyTarget(targetId)) return CURRENT_MONTH_INDEX;
  const student = (AppState.students || []).find(s => s.id === targetId);
  if (!student || !Array.isArray(student.months)) return CURRENT_MONTH_INDEX;

  // 1. Look for current month if due
  const curM = student.months[CURRENT_MONTH_INDEX];
  if (curM && curM.status !== 'not_enrolled' && (curM.status === 'defaulter' || curM.status === 'partial' || curM.remainingDue > 0)) {
    return CURRENT_MONTH_INDEX;
  }

  // 2. Look for oldest overdue month
  for (let i = 0; i < CURRENT_MONTH_INDEX; i++) {
    const m = student.months[i];
    if (m && m.status !== 'not_enrolled' && (m.status === 'defaulter' || m.status === 'partial' || m.remainingDue > 0)) {
      return i;
    }
  }

  // 3. If current month is paid/advance, find first upcoming month that is not yet paid
  if (curM && (curM.status === 'paid' || curM.status === 'advance')) {
    for (let i = CURRENT_MONTH_INDEX + 1; i < student.months.length; i++) {
      const m = student.months[i];
      if (m && m.status !== 'paid' && m.status !== 'advance') {
        return i;
      }
    }
  }

  return CURRENT_MONTH_INDEX;
}
window.getNextPayableMonthIndex = getNextPayableMonthIndex;

/**
 * Open Receive Fee Modal with live FIFO Waterfall preview supporting dynamic Family groups
 * Defaults to individual student mode and current month's due
 */
function openReceiveFeeModal(preselectedTarget = null) {
  const modal = document.getElementById('receive-fee-modal');
  if (!modal) return;

  if (!AppState.students || AppState.students.length === 0) {
    showToastNotification('Please enroll at least one student before recording tuition payments.');
    openAddStudentModal();
    return;
  }

  // Default to first individual student if no target specified
  if (!preselectedTarget) {
    preselectedTarget = AppState.students[0]?.id;
  }

  // Build dynamic families map
  const familiesMap = {};
  AppState.students.forEach(s => {
    const famId = s.familyId || s.familyTag || 'FAM-101';
    if (!familiesMap[famId]) {
      familiesMap[famId] = {
        familyId: famId,
        guardianName: s.guardianName || 'Guardian',
        students: [],
        totalMonthlyFee: 0,
        currency: s.currency || '$',
        totalDue: 0
      };
    }
    familiesMap[famId].students.push(s);
    familiesMap[famId].totalMonthlyFee += Number(s.monthlyFee) || 0;
    familiesMap[famId].totalDue += getStudentBalanceDue(s);
  });

  const selectEl = document.getElementById('modal-fee-student-select');
  if (selectEl) {
    // Individual Student Enrollees optgroup FIRST (Individual default mode)
    let optionsHtml = '<optgroup label="Individual Student Enrollees">';
    optionsHtml += AppState.students.map(s => {
      const bal = getStudentBalanceDue(s);
      const balText = bal > 0 ? ` • -${s.currency}${bal} Due` : ' • Clear ✓';
      return `
        <option value="${s.id}" ${s.id === preselectedTarget ? 'selected' : ''}>
          ${s.id} - ${s.firstName} ${s.lastName} (${s.familyId || s.familyTag} • ${s.currency}${s.monthlyFee}/mo${balText})
        </option>
      `;
    }).join('');
    optionsHtml += '</optgroup>';

    // Family / Sibling Combined Groups second
    optionsHtml += '<optgroup label="Family / Sibling Combined Groups">';
    Object.values(familiesMap).forEach(fam => {
      const names = fam.students.map(st => st.firstName).join(' & ');
      const siblingCountText = fam.students.length > 1 ? `${fam.students.length} Siblings` : '1 Student';
      const dueText = fam.totalDue > 0 ? ` • -${fam.currency}${fam.totalDue} Due` : ' • Clear ✓';
      optionsHtml += `
        <option value="${fam.familyId}" ${preselectedTarget === fam.familyId ? 'selected' : ''}>
          [FAMILY GROUP] ${fam.familyId}: ${fam.guardianName} (${names} • ${siblingCountText} • Combined ${fam.currency}${fam.totalMonthlyFee}/mo${dueText})
        </option>
      `;
    });
    optionsHtml += '</optgroup>';

    selectEl.innerHTML = optionsHtml;
    selectEl.value = preselectedTarget;
  }

  // Populate Target Academic Month dropdown (defaults to actual payable month)
  const defaultMonthIdx = getNextPayableMonthIndex(preselectedTarget);
  populateModalFeeMonthSelect(preselectedTarget, defaultMonthIdx);

  // Set default amount intelligently based on selection
  const amountInput = document.getElementById('modal-fee-amount-input');
  if (amountInput) {
    if (preselectedTarget && isFamilyTarget(preselectedTarget)) {
      const fam = familiesMap[preselectedTarget] || Object.values(familiesMap).find(f => f.familyId === preselectedTarget);
      amountInput.value = (fam && fam.totalDue > 0 ? fam.totalDue : (fam ? fam.totalMonthlyFee : 50)).toString();
    } else {
      const student = (AppState.students || []).find(s => s.id === preselectedTarget) || AppState.students[0];
      const curMonth = student?.months ? student.months[defaultMonthIdx] : null;
      const curDue = curMonth ? (curMonth.remainingDue > 0 ? curMonth.remainingDue : curMonth.feeDue) : (Number(student?.monthlyFee) || 50);
      amountInput.value = (curDue > 0 ? curDue : (Number(student?.monthlyFee) || 50)).toString();
    }
  }

  // Update dynamic presets
  updateModalFeePresets(preselectedTarget);

  modal.classList.add('active');
  updateFIFOPreview();
}

function closeReceiveFeeModal() {
  const modal = document.getElementById('receive-fee-modal');
  if (modal) modal.classList.remove('active');
}

function handleFeeTargetChange() {
  const selectEl = document.getElementById('modal-fee-student-select');
  const amountInput = document.getElementById('modal-fee-amount-input');
  if (selectEl && amountInput) {
    const val = selectEl.value;
    const defaultMonthIdx = getNextPayableMonthIndex(val);
    populateModalFeeMonthSelect(val, defaultMonthIdx);

    if (val && isFamilyTarget(val)) {
      const famStudents = (AppState.students || []).filter(s => s.familyId === val || s.familyTag === val);
      let totalDue = 0;
      let totalMonthly = 0;
      famStudents.forEach(st => {
        totalDue += getStudentBalanceDue(st);
        totalMonthly += Number(st.monthlyFee) || 0;
      });
      amountInput.value = (totalDue > 0 ? totalDue : (totalMonthly || 50)).toString();
    } else if (val) {
      const student = (AppState.students || []).find(s => s.id === val);
      if (student) {
        const curMonth = student.months ? student.months[defaultMonthIdx] : null;
        const curDue = curMonth ? (curMonth.remainingDue > 0 ? curMonth.remainingDue : curMonth.feeDue) : (Number(student.monthlyFee) || 50);
        amountInput.value = (curDue > 0 ? curDue : (Number(student.monthlyFee) || 50)).toString();
      }
    }
    updateModalFeePresets(val);
  }
  updateFIFOPreview();
}

function setModalAmount(amt) {
  const selectEl = document.getElementById('modal-fee-student-select');
  const amountInput = document.getElementById('modal-fee-amount-input');
  if (!amountInput) return;

  const targetId = selectEl ? selectEl.value : null;

  if (amt === 'full') {
    if (targetId && isFamilyTarget(targetId)) {
      const famStudents = (AppState.students || []).filter(s => s.familyId === targetId || s.familyTag === targetId);
      let totalDue = 0;
      let totalMonthly = 0;
      famStudents.forEach(st => {
        totalDue += getStudentBalanceDue(st);
        totalMonthly += Number(st.monthlyFee) || 0;
      });
      amountInput.value = (totalDue > 0 ? totalDue : (totalMonthly || 50)).toString();
    } else if (targetId) {
      const student = (AppState.students || []).find(s => s.id === targetId);
      if (student) {
        const bal = getStudentBalanceDue(student);
        amountInput.value = (bal > 0 ? bal : (Number(student.monthlyFee) || 50)).toString();
      }
    }
  } else {
    amountInput.value = amt.toString();
  }
  updateFIFOPreview();
}

/**
 * Live updates the Waterfall payment preview table inside modal as Admin types
 */
function updateFIFOPreview() {
  const selectEl = document.getElementById('modal-fee-student-select');
  const amountInput = document.getElementById('modal-fee-amount-input');
  const monthSelect = document.getElementById('modal-fee-month-select');
  const previewContainer = document.getElementById('fifo-allocation-preview');

  if (!selectEl || !amountInput || !previewContainer) return;

  const targetId = selectEl.value;
  const amount = Number(amountInput.value) || 0;
  const targetMonthIdx = monthSelect ? parseInt(monthSelect.value, 10) : CURRENT_MONTH_INDEX;

  if (!targetId || amount <= 0) {
    previewContainer.innerHTML = `
      <div class="text-center py-6 text-xs text-[#7A8684] bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4]">
        Enter payment amount to generate live allocation preview.
      </div>
    `;
    return;
  }

  const result = calculateFIFOWaterfall(targetId, amount, targetMonthIdx);

  // If the target month selected was already fully paid and allocation landed in another month, update select to agree
  if (result.allocations.length > 0 && monthSelect) {
    const firstAllocMonth = result.allocations[0].monthIndex;
    if (monthSelect.value != firstAllocMonth) {
      const curSelectedM = (AppState.students || []).find(s => s.id === targetId)?.months?.[targetMonthIdx];
      if (curSelectedM && (curSelectedM.status === 'paid' || curSelectedM.status === 'advance' || curSelectedM.remainingDue === 0)) {
        monthSelect.value = firstAllocMonth;
      }
    }
  }

  if (result.allocations.length === 0) {
    previewContainer.innerHTML = `
      <div class="text-center py-6 text-xs text-[#065F46] bg-[#D1FAE5] rounded-2xl border border-[#6EE7B7]">
        Account has no past due balance. Any payment will be applied as Advance Credit for future months.
      </div>
    `;
    return;
  }

  const currency = result.studentSimulations[0]?.currency || '$';
  const isFamily = result.isFamily;
  const previewCurrencyCode = result.studentSimulations[0]?.currencyCode || null;
  let pkrPreviewHtml = '';
  if (previewCurrencyCode && String(previewCurrencyCode).toUpperCase() !== 'PKR') {
    const previewRate = getCurrencyRate(previewCurrencyCode);
    pkrPreviewHtml = previewRate !== null
      ? `<span class="text-[#0E4D45] font-semibold">≈ ${formatPKRAmount(Math.round(amount * previewRate))}</span><span class="text-[#7A8684] font-normal">(1 ${previewCurrencyCode} = ${formatPKRAmount(previewRate)})</span>`
      : `<span class="text-amber-700 font-semibold">PKR equivalent not available — set the ${previewCurrencyCode} rate in Currency Settings.</span>`;
  }

  let html = `
    <div class="rounded-2xl border border-[#ECEAE4] overflow-hidden">
      <div class="bg-[#F8F6F1] px-4 py-2.5 border-b border-[#ECEAE4] flex items-center justify-between text-xs">
        <span class="font-bold text-[#141F1E]">Allocation Breakdown ${isFamily ? '• Combined Family' : ''}</span>
        <span class="text-right flex flex-col items-end leading-tight"><span class="text-[#0E4D45] font-semibold">${currency}${amount} Allocated</span>${pkrPreviewHtml ? `<span class="text-[11px] flex items-center gap-1">${pkrPreviewHtml}</span>` : ''}</span>
      </div>
      <table class="w-full text-xs text-left responsive-table-cards">
        <thead class="bg-[#FFFFFF] border-b border-[#ECEAE4] text-[10px] font-semibold text-[#7A8684]">
          <tr>
            <th class="p-2.5">Month</th>
            ${isFamily ? '<th class="p-2.5">Student</th>' : ''}
            <th class="p-2.5">Monthly Fee</th>
            <th class="p-2.5">Allocated</th>
            <th class="p-2.5">Previous Status</th>
            <th class="p-2.5">New Status</th>
            <th class="p-2.5 text-right">Remaining Due</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[#ECEAE4]">
          ${result.allocations.map(a => `
            <tr class="hover:bg-[#F8F6F1]/50">
              <td class="p-2.5 font-bold text-[#141F1E]" data-label="Month">${a.month} 2026</td>
              ${isFamily ? `<td class="p-2.5 font-medium text-[#0E4D45]" data-label="Student">${a.studentName.split(' ')[0]}</td>` : ''}
              <td class="p-2.5 text-[#7A8684]" data-label="Monthly Fee">${a.currency}${a.feeDue}</td>
              <td class="p-2.5 font-bold text-[#0E4D45]" data-label="Allocated">+${a.currency}${a.allocatedAmount}</td>
              <td class="p-2.5" data-label="Previous Status"><span class="text-[10px] font-semibold text-[#7A8684]">${a.prevStatus}</span></td>
              <td class="p-2.5" data-label="New Status">
                <span class="ts-badge ${a.newStatus === 'paid' ? 'ts-badge-paid' : (a.newStatus === 'advance' ? 'ts-badge-advance' : 'ts-badge-partial')}">
                  ${a.newStatus.charAt(0).toUpperCase() + a.newStatus.slice(1)}
                </span>
              </td>
              <td class="p-2.5 text-right font-bold ${a.newRemainingDue > 0 ? 'text-[#991B1B]' : 'text-[#065F46]'}" data-label="Remaining Due">
                ${a.newRemainingDue > 0 ? `-${a.currency}${a.newRemainingDue}` : 'Settled ✓'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="bg-[#F8F6F1] p-3 text-xs flex items-center justify-between border-t border-[#ECEAE4]">
        <span class="text-[#7A8684]">New Total Balance:</span>
        <span class="font-bold ${result.newTotalDue > 0 ? 'text-[#991B1B]' : 'text-[#065F46]'}">
          ${result.newTotalDue > 0 ? `-${currency}${result.newTotalDue} Due` : 'Clear ✓ ($0.00)'}
        </span>
      </div>
    </div>
  `;

  previewContainer.innerHTML = html;
}

/**
 * Commits fee from modal
 */
function handleSaveFeePayment() {
  const selectEl = document.getElementById('modal-fee-student-select');
  const amountInput = document.getElementById('modal-fee-amount-input');
  const monthSelect = document.getElementById('modal-fee-month-select');
  const methodSelect = document.getElementById('modal-fee-method-select');

  if (!selectEl || !amountInput) return;

  const modalContainer = document.getElementById('receive-fee-modal') || document.body;
  clearAllFormErrors(modalContainer);

  const targetId = selectEl.value;
  const amount = Number(amountInput.value);
  const targetMonthIdx = monthSelect ? parseInt(monthSelect.value, 10) : CURRENT_MONTH_INDEX;
  const method = methodSelect ? methodSelect.value : 'Online Portal';

  let hasError = false;
  if (!targetId) {
    setFormFieldError('modal-fee-student-select', 'Please select a student or family group.');
    hasError = true;
  }
  if (!amount || isNaN(amount) || amount <= 0) {
    setFormFieldError('modal-fee-amount-input', 'Please enter a valid payment amount (> 0).');
    hasError = true;
  }
  if (hasError) return;

  try {
    const res = commitFIFOPayment(targetId, amount, method, targetMonthIdx);
    if (res) {
      closeReceiveFeeModal();
      renderApp();
      showToastNotification(`✓ Payment of ${res.currency}${amount}${(typeof res.pkrAmount === 'number') ? ' (≈ ' + formatPKRAmount(res.pkrAmount) + ')' : ''} recorded successfully. Receipt ${res.txnId} generated.`);
    } else {
      showActionErrorModal({
        title: 'Payment Processing Failed',
        message: 'Unable to commit payment transaction for the selected account.',
        onRetry: () => handleSaveFeePayment()
      });
    }
  } catch (err) {
    console.error('Payment error:', err);
    showActionErrorModal({
      title: 'Payment Processing Error',
      message: err.message || 'An unexpected error occurred while processing fee settlement.',
      onRetry: () => handleSaveFeePayment()
    });
  }
}

/**
 * Preset Scenarios for instant 1-click verification
 */
function loadTestScenario(scenarioKey) {
  openReceiveFeeModal();
  const selectEl = document.getElementById('modal-fee-student-select');
  const amountInput = document.getElementById('modal-fee-amount-input');

  if (scenarioKey === 'tariq_120') {
    if (selectEl) selectEl.value = 'QA-1008';
    if (amountInput) amountInput.value = '120';
  } else if (scenarioKey === 'tariq_250') {
    if (selectEl) selectEl.value = 'QA-1008';
    if (amountInput) amountInput.value = '250';
  } else if (scenarioKey === 'family_90') {
    if (selectEl) selectEl.value = 'FAM-102';
    if (amountInput) amountInput.value = '90';
  }
  updateFIFOPreview();
}

/**
 * 1-Click test scenario for Tariq Mansoor ($120 on 3-month defaulter)
 */
function quickTestTariqWaterfall() {
  loadTestScenario('tariq_120');
}

/**
 * Month Detail Modal Breakdown (Stripe SaaS Billing Quick Action Drawer)
 */
function openMonthDetailModal(studentId, monthIndex) {
  const student = AppState.students.find(s => s.id === studentId);
  if (!student) return;
  const m = student.months[monthIndex];
  if (!m) return;

  const modal = document.getElementById('month-detail-modal');
  const content = document.getElementById('month-detail-content');
  if (!modal || !content) return;

  const monthName = MONTHS_LIST[monthIndex] || m.month;
  const isPaid = m.status === 'paid';
  const isAdvance = m.status === 'advance';
  const dueAmount = m.remainingDue > 0 ? m.remainingDue : (m.status === 'defaulter' ? m.feeDue : 0);

  // Look up associated payment transaction in PAYMENT_LEDGER
  let matchedPayment = null;
  if (Array.isArray(PAYMENT_LEDGER)) {
    for (const p of PAYMENT_LEDGER) {
      if (Array.isArray(p.allocations)) {
        const alloc = p.allocations.find(a => 
          (a.studentId === student.id || String(a.studentId || '').trim().toLowerCase() === String(student.id || '').trim().toLowerCase()) &&
          (a.monthIndex === monthIndex || (a.month && a.month.toLowerCase() === monthName.toLowerCase()))
        );
        if (alloc) {
          matchedPayment = {
            id: p.id,
            date: p.date || '2026-11-24',
            method: p.method || 'Online Card (Stripe)',
            amount: alloc.allocatedAmount || p.amount,
            currency: alloc.currency || p.currency || student.currency || '$',
            status: p.status || 'Completed'
          };
          break;
        }
      }
      if (p.studentId === student.id || String(p.studentId || '').trim().toLowerCase() === String(student.id || '').trim().toLowerCase()) {
        if (p.date) {
          const d = new Date(p.date);
          if (!isNaN(d.getTime()) && d.getMonth() === monthIndex) {
            matchedPayment = {
              id: p.id,
              date: p.date || '2026-11-24',
              method: p.method || 'Online Card (Stripe)',
              amount: p.amount,
              currency: p.currency || student.currency || '$',
              status: p.status || 'Completed'
            };
            break;
          }
        }
      }
    }
  }

  // Fallback for baseline records if not caught by loop
  if (!matchedPayment) {
    if (isPaid && (m.receiptNo || m.amountPaid > 0)) {
      matchedPayment = {
        id: m.receiptNo || 'TXN-SETTLED',
        date: m.paymentDate || '2026-11-24',
        method: m.paymentMethod || 'Online Card (Stripe)',
        amount: m.amountPaid,
        currency: student.currency || '$',
        status: 'Completed'
      };
    }
  }

  let statusBadge = '';
  if (isPaid) {
    statusBadge = `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#D1FAE5] text-[#065F46] border border-[#A7F3D0]">
        <span class="w-1.5 h-1.5 rounded-full bg-[#10B981]"></span>
        ${m.waived ? 'Waived / Scholarship' : `Paid in Full (${student.currency}${m.amountPaid})${matchedPayment ? ` • #${matchedPayment.id}` : ''}`}
      </span>
    `;
  } else if (m.status === 'partial') {
    statusBadge = `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
        <span class="w-1.5 h-1.5 rounded-full bg-[#F59E0B]"></span>
        Partial (${student.currency}${m.amountPaid} Paid • -${student.currency}${m.remainingDue} Due)${matchedPayment ? ` • #${matchedPayment.id}` : ''}
      </span>
    `;
  } else if (isAdvance) {
    statusBadge = `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#E8EFEE] text-[#0E4D45] border border-[#CBD5E1]">
        <span class="w-1.5 h-1.5 rounded-full bg-[#0E4D45]"></span>
        Advance Credit Active (${student.currency}${m.amountPaid})
      </span>
    `;
  } else if (m.status === 'defaulter') {
    statusBadge = `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA]">
        <span class="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-pulse"></span>
        Overdue Balance (-${student.currency}${m.feeDue})
      </span>
    `;
  } else {
    statusBadge = `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#F1F5F9] text-[#64748B] border border-[#E2E8F0]">
        <span class="w-1.5 h-1.5 rounded-full bg-[#94A3B8]"></span>
        Upcoming (${student.currency}${m.feeDue})
      </span>
    `;
  }

  content.innerHTML = `
    <div class="p-6">
      <!-- Modal Header -->
      <div class="flex items-start justify-between gap-3 pb-4 border-b border-[#ECEAE4]">
        <div class="flex items-center gap-3 min-w-0 flex-1 pr-2">
          <img 
            src="${student.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=faces'}" 
            alt="${student.firstName}" 
            class="w-11 h-11 rounded-full object-cover shrink-0 border border-[#ECEAE4] shadow-2xs" 
            onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(student.firstName + ' ' + student.lastName)}&background=0E4D45&color=fff';" 
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-base font-bold text-[#141F1E] leading-snug">${student.firstName} ${student.lastName}</h3>
              <span class="px-2 py-0.5 rounded-full bg-[#E8EFEE] text-[10px] font-bold text-[#0E4D45] shrink-0">${student.id}</span>
            </div>
            <p class="text-xs text-[#7A8684] mt-0.5 truncate">${student.course || 'Quran Studies'} • ${student.country} • Family: <span class="font-semibold text-[#141F1E]">${student.familyId}</span></p>
          </div>
        </div>
        <button type="button" onclick="closeMonthDetailModal()" class="w-8 h-8 rounded-xl border border-[#ECEAE4] bg-white flex items-center justify-center text-[#7A8684] hover:text-[#141F1E] hover:bg-[#F8F6F1] transition-colors cursor-pointer shrink-0" title="Close">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <!-- Month Billing Item Context -->
      <div class="py-4">
        <div class="flex items-center justify-between p-3 bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4] mb-4">
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-lg bg-white border border-[#ECEAE4] flex items-center justify-center text-[#0E4D45]">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
            </span>
            <div>
              <span class="text-xs font-bold text-[#141F1E] block">${monthName} ${CURRENT_YEAR} Fee Record</span>
              <span class="text-[11px] text-[#7A8684]">Target Academic Month</span>
            </div>
          </div>
          <div>${statusBadge}</div>
        </div>

        <!-- 3-Column Stripe Style Financial Metrics -->
        <div class="grid grid-cols-3 gap-3 p-4 bg-white rounded-2xl border border-[#ECEAE4] shadow-2xs mb-4">
          <div>
            <span class="text-[11px] text-[#7A8684] font-medium block">Tuition Fee</span>
            <span class="text-base font-extrabold text-[#141F1E] mt-0.5 block">${student.currency}${m.feeDue}</span>
          </div>
          <div>
            <span class="text-[11px] text-[#7A8684] font-medium block">Amount Settled</span>
            <span class="text-base font-extrabold text-[#0E4D45] mt-0.5 block">${student.currency}${m.amountPaid}</span>
          </div>
          <div>
            <span class="text-[11px] text-[#7A8684] font-medium block">Balance Due</span>
            <span class="text-base font-extrabold ${dueAmount > 0 ? 'text-[#991B1B]' : 'text-[#065F46]'} mt-0.5 block">
              ${dueAmount > 0 ? `-${student.currency}${dueAmount}` : 'Clear ✓'}
            </span>
          </div>
        </div>

        ${matchedPayment ? `
          <!-- Verified Payment Settlement & Receipt Audit Card -->
          <div class="p-4 bg-[#F8F6F1] rounded-2xl border border-[#ECEAE4] mb-4">
            <div class="flex items-center justify-between pb-2.5 mb-2.5 border-b border-[#ECEAE4]">
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 rounded-full bg-[#D1FAE5] text-[#065F46] flex items-center justify-center text-xs font-bold">✓</span>
                <span class="text-xs font-bold text-[#141F1E]">Verified Payment Settlement</span>
              </div>
              <span class="px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-white text-[#0E4D45] border border-[#ECEAE4]">
                Receipt #${matchedPayment.id}
              </span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span class="text-[10px] text-[#7A8684] uppercase font-semibold block">Payment Date</span>
                <span class="font-semibold text-[#141F1E] mt-0.5 block">${matchedPayment.date}</span>
              </div>
              <div>
                <span class="text-[10px] text-[#7A8684] uppercase font-semibold block">Payment Method</span>
                <span class="font-semibold text-[#141F1E] mt-0.5 block">${matchedPayment.method}</span>
              </div>
              <div>
                <span class="text-[10px] text-[#7A8684] uppercase font-semibold block">Settled Amount</span>
                <span class="font-bold text-[#0E4D45] mt-0.5 block">${matchedPayment.currency || student.currency}${matchedPayment.amount}</span>
              </div>
            </div>
          </div>
        ` : ''}
            <span class="text-[11px] text-[#7A8684] font-medium block">Balance Due</span>
            <span class="text-base font-extrabold ${dueAmount > 0 ? 'text-[#991B1B]' : 'text-[#065F46]'} mt-0.5 block">
              ${dueAmount > 0 ? `-${student.currency}${dueAmount}` : 'Clear ✓'}
            </span>
          </div>
        </div>

        <!-- Quick Actions Panel -->
        <div class="space-y-2">
          <span class="text-[11px] font-semibold text-[#7A8684] block mb-1">Quick Ledger Actions:</span>
          
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <!-- Action 1: Settle / Record Payment -->
            <button onclick="quickRecordMonthPayment('${student.id}', ${monthIndex})" 
              class="w-full p-3 rounded-xl border border-[#ECEAE4] hover:border-[#0E4D45] bg-[#FFFFFF] hover:bg-[#F8F6F1] transition-all text-left flex items-center gap-3 cursor-pointer group shadow-2xs">
              <div class="w-9 h-9 rounded-lg bg-[#E8EFEE] group-hover:bg-[#0E4D45] text-[#0E4D45] group-hover:text-white flex items-center justify-center transition-colors shrink-0">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
              </div>
              <div class="min-w-0">
                <span class="text-xs font-bold text-[#141F1E] group-hover:text-[#0E4D45] block">Record Payment</span>
                <span class="text-[10px] text-[#7A8684] truncate block">Automated fee settlement</span>
              </div>
            </button>

            <!-- Action 2: Waive Fee / Scholarship -->
            <button onclick="waiveStudentMonthFee('${student.id}', ${monthIndex})" 
              class="w-full p-3 rounded-xl border border-[#ECEAE4] hover:border-[#065F46] bg-[#FFFFFF] hover:bg-[#F8F6F1] transition-all text-left flex items-center gap-3 cursor-pointer group shadow-2xs">
              <div class="w-9 h-9 rounded-lg bg-[#D1FAE5] group-hover:bg-[#065F46] text-[#065F46] group-hover:text-white flex items-center justify-center transition-colors shrink-0">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
              </div>
              <div class="min-w-0">
                <span class="text-xs font-bold text-[#141F1E] group-hover:text-[#065F46] block">Waive Fee (Scholarship)</span>
                <span class="text-[10px] text-[#7A8684] truncate block">Excuse & clear balance</span>
              </div>
            </button>

            <!-- Action 3: Send WhatsApp Reminder -->
            <button onclick="sendSpecificMonthWhatsApp('${student.id}', ${monthIndex})" 
              class="w-full p-3 rounded-xl border border-[#ECEAE4] hover:border-[#25D366] bg-[#FFFFFF] hover:bg-[#F8F6F1] transition-all text-left flex items-center gap-3 cursor-pointer group shadow-2xs">
              <div class="w-9 h-9 rounded-lg bg-[#DCFCE7] group-hover:bg-[#15803D] text-[#15803D] group-hover:text-white flex items-center justify-center transition-colors shrink-0">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
              </div>
              <div class="min-w-0">
                <span class="text-xs font-bold text-[#141F1E] group-hover:text-[#15803D] block">WhatsApp Reminder</span>
                <span class="text-[10px] text-[#7A8684] truncate block">Targeted ${monthName} note</span>
              </div>
            </button>

            <!-- Action 4: Reset Month State -->
            <button onclick="resetStudentMonthFee('${student.id}', ${monthIndex})" 
              class="w-full p-3 rounded-xl border border-[#ECEAE4] hover:border-[#EF4444] bg-[#FFFFFF] hover:bg-[#F8F6F1] transition-all text-left flex items-center gap-3 cursor-pointer group shadow-2xs">
              <div class="w-9 h-9 rounded-lg bg-[#FEE2E2] group-hover:bg-[#EF4444] text-[#991B1B] group-hover:text-white flex items-center justify-center transition-colors shrink-0">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              </div>
              <div class="min-w-0">
                <span class="text-xs font-bold text-[#141F1E] group-hover:text-[#991B1B] block">Reset Month State</span>
                <span class="text-[10px] text-[#7A8684] truncate block">Restore default status</span>
              </div>
            </button>
          </div>
        </div>

      </div>

      <!-- Modal Footer -->
      <div class="pt-4 border-t border-[#ECEAE4] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <button type="button" onclick="closeMonthDetailModal(); openReceiveFeeModal('${student.id}');" class="w-full sm:w-auto order-1 sm:order-2 py-3 px-5 rounded-lg bg-[#0e4f3f] text-white font-medium text-xs sm:text-sm hover:bg-[#0b3e32] transition-colors shadow-sm cursor-pointer text-center">
          Open Full FIFO Modal
        </button>
        <button type="button" onclick="closeMonthDetailModal()" class="w-full sm:w-auto order-2 sm:order-1 px-4 py-2.5 text-xs font-semibold rounded-lg bg-[#FFFFFF] border border-[#ECEAE4] text-[#7A8684] hover:text-[#141F1E] hover:bg-[#F8F6F1] transition-colors cursor-pointer text-center">
          Dismiss
        </button>
      </div>
    </div>
  `;

  modal.classList.add('active');
}

function closeMonthDetailModal() {
  const modal = document.getElementById('month-detail-modal');
  if (modal) modal.classList.remove('active');
}

function waiveStudentMonthFee(studentId, monthIndex) {
  const student = AppState.students.find(s => s.id === studentId);
  if (!student) return;
  const m = student.months[monthIndex];
  if (!m) return;

  m.status = 'paid';
  m.amountPaid = m.feeDue;
  m.remainingDue = 0;
  m.waived = true;
  m.waivedNote = 'Scholarship / Waived by Admin Farhan';

  closeMonthDetailModal();
  renderApp();
  showToastNotification(`✓ ${m.month} ${CURRENT_YEAR} tuition fee for ${student.firstName} marked as Waived (Scholarship).`);
}

function resetStudentMonthFee(studentId, monthIndex) {
  const student = AppState.students.find(s => s.id === studentId);
  if (!student) return;
  const m = student.months[monthIndex];
  if (!m) return;

  m.status = monthIndex < CURRENT_MONTH_INDEX ? 'paid' : (monthIndex === CURRENT_MONTH_INDEX ? 'defaulter' : 'upcoming');
  m.amountPaid = m.status === 'paid' ? m.feeDue : 0;
  m.remainingDue = m.status === 'defaulter' ? m.feeDue : 0;
  m.waived = false;

  closeMonthDetailModal();
  renderApp();
  showToastNotification(`✓ ${m.month} ${CURRENT_YEAR} state for ${student.firstName} restored.`);
}

function sendSpecificMonthWhatsApp(studentId, monthIndex) {
  const student = AppState.students.find(s => s.id === studentId);
  if (!student) return;
  const m = student.months[monthIndex];
  const balance = m.remainingDue > 0 ? m.remainingDue : (m.status === 'defaulter' ? m.feeDue : m.feeDue);
  const parentName = student.guardianName || 'Respected Parent';
  const cleanPhone = (student.whatsapp || student.phone || '').replace(/[^0-9]/g, '');
  
  const msg = `Assalam-o-Alaikum ${parentName}, this is an official tuition notice from Quranic Skills regarding ${student.firstName} (${student.id}). The tuition balance is ${student.currency}${balance} for ${m.month} ${CURRENT_YEAR}. Please settle via student portal or bank transfer. JazakAllah Khair!`;

  closeMonthDetailModal();
  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  showToastNotification(`✓ WhatsApp reminder drafted for ${student.firstName} (${m.month} ${CURRENT_YEAR})`);
}

function quickRecordMonthPayment(studentId, monthIndex) {
  closeMonthDetailModal();
  openReceiveFeeModal(studentId);
  setTimeout(() => {
    const student = AppState.students.find(s => s.id === studentId);
    if (!student) return;
    const m = student.months[monthIndex];
    const amountInput = document.getElementById('modal-fee-amount-input');
    if (amountInput && m) {
      amountInput.value = (m.remainingDue > 0 ? m.remainingDue : m.feeDue).toString();
      updateFIFOPreview();
    }
  }, 100);
}

/**
 * 30-Second Zero-Typing Sabaq Logger Modal
 */
function openSabaqLoggerModal(preselectedStudentId = 'QA-1042') {
  const modal = document.getElementById('sabaq-logger-modal');
  if (!modal) return;

  const select = document.getElementById('logger-student-select');
  if (select) {
    select.innerHTML = AppState.students.map(s => `
      <option value="${s.id}" ${s.id === preselectedStudentId ? 'selected' : ''}>
        ${s.id} • ${s.firstName} (${s.country})
      </option>
    `).join('');
  }

  modal.classList.add('active');
}

function closeSabaqLoggerModal() {
  const modal = document.getElementById('sabaq-logger-modal');
  if (modal) modal.classList.remove('active');
}

function handleSaveSabaq() {
  const modalContainer = document.getElementById('sabaq-logger-modal') || document.body;
  clearAllFormErrors(modalContainer);

  const studentId = document.getElementById('logger-student-select')?.value;
  if (!studentId) {
    setFormFieldError('logger-student-select', 'Please select a student from the dropdown.');
    return;
  }
  const student = AppState.students.find(s => s.id === studentId);
  if (!student) {
    setFormFieldError('logger-student-select', 'Selected student record could not be found.');
    return;
  }
  const surah = document.getElementById('logger-surah-input')?.value || 'Surah Al-Mulk (Ayah 1-15)';
  const statusEl = document.querySelector('.attendance-pill.selected');
  const attendanceStatus = statusEl ? statusEl.dataset.status : 'Present';

  // Get selected tags
  const selectedTagEls = document.querySelectorAll('.remark-tag-pill.selected');
  const tags = Array.from(selectedTagEls).map(el => el.textContent.trim());

  if (student) {
    const todayIso = new Date().toISOString().split('T')[0];
    const sabaqEntry = {
      date: todayIso,
      type: 'Daily Sabaq',
      surah: surah,
      status: attendanceStatus,
      rating: 5,
      tags: tags.length ? tags : ['MashaAllah Good'],
      teacherNote: 'Logged in 30 seconds via zero-typing workflow.'
    };
    student.lastSabaq = sabaqEntry;
    if (!student.sabaqHistory) student.sabaqHistory = [];
    student.sabaqHistory.push(sabaqEntry);

    saveToStorage('lms_students', AppState.students);
    dbSaveStudent(student);

    // Record live attendance log in Firestore
    const logDoc = {
      id: 'LOG-' + Date.now(),
      studentId: student.id,
      studentName: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
      date: todayIso,
      status: attendanceStatus,
      passed: (attendanceStatus === 'Present' || attendanceStatus === 'Late') && sabaqEntry.rating >= 3,
      rating: sabaqEntry.rating || 5,
      surah: surah,
      timestamp: Date.now()
    };
    dbSaveAttendanceLog(logDoc);
  }

  closeSabaqLoggerModal();
  renderApp();
  showToastNotification(`✓ Sabaq successfully logged for ${student?.firstName || 'Student'} in under 30 seconds!`);
}

/**
 * Substitute Teacher Modal
 */
function openSubstituteModal() {
  const modal = document.getElementById('substitute-modal');
  if (modal) {
    const origSelect = document.getElementById('substitute-original-teacher');
    const targetSelect = document.getElementById('substitute-target-teacher');
    if (origSelect && AppState.teachers && AppState.teachers.length > 0) {
      origSelect.innerHTML = AppState.teachers.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    }
    if (targetSelect && AppState.teachers && AppState.teachers.length > 0) {
      targetSelect.innerHTML = AppState.teachers.map(t => `<option value="${t.id}">${t.name} (${t.status || 'Available'})</option>`).join('');
    }
    modal.classList.add('active');
  }
}

function closeSubstituteModal() {
  const modal = document.getElementById('substitute-modal');
  if (modal) modal.classList.remove('active');
}

function handleAssignSubstitute() {
  closeSubstituteModal();
  showToastNotification('✓ Substitute teacher assigned and automated alert dispatched via Academy Gateway!');
}

/**
 * System Reminder Alert (Manager)
 */
function triggerSystemReminder(studentId) {
  const student = AppState.students.find(s => s.id === studentId);
  if (!student) return;

  showToastNotification(`✓ Automated WhatsApp & Email reminder queued for guardian of ${student.id} (PII protected).`);
}

/**
 * Official Receipt Modal
 */
function openReceiptModal(txnId = 'TXN-9021') {
  const txn = PAYMENT_LEDGER.find(t => t.id === txnId) || PAYMENT_LEDGER[0];
  if (!txn) {
    showToastNotification('No payment receipt records found yet.');
    return;
  }
  const modal = document.getElementById('receipt-modal');
  const content = document.getElementById('receipt-modal-content');

  if (!modal || !content) return;

  content.innerHTML = `
    <div class="p-8">
      <!-- Receipt Header -->
      <div class="flex items-start justify-between pb-6 border-b border-[#ECEAE4]">
        <div>
          <div class="flex items-center gap-2.5 mb-1">
            <div class="w-8 h-8 rounded-lg bg-[#0E4D45] text-white flex items-center justify-center">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
            </div>
            <span class="font-bold text-[#141F1E] text-base">Quranic Skills Academy</span>
          </div>
          <p class="text-xs text-[#7A8684]">Global Online Quranic Education & Hifz Institute</p>
          <p class="text-[11px] text-[#7A8684]">Tax ID: QSA-98234-LMS • support@quranicskills.com</p>
        </div>
        <div class="text-right">
          <span class="text-xs font-bold text-[#0E4D45] uppercase tracking-wider">Official Fee Receipt</span>
          <p class="text-lg font-bold text-[#141F1E] mt-0.5">${txn.id}</p>
          <p class="text-xs text-[#7A8684]">Date: ${txn.date}</p>
        </div>
      </div>

      <!-- Receipt Body -->
      <div class="py-6 border-b border-[#ECEAE4] space-y-4">
        <div class="grid grid-cols-2 gap-4 text-xs">
          <div>
            <span class="text-[#7A8684]">Student / Enrollee:</span>
            <p class="font-bold text-[#141F1E] text-sm mt-0.5">${txn.studentName}</p>
            <p class="text-[#7A8684] text-[11px]">ID: ${txn.studentId}</p>
          </div>
          <div>
            <span class="text-[#7A8684]">Payment Method:</span>
            <p class="font-bold text-[#141F1E] text-sm mt-0.5">${txn.method}</p>
            <p class="text-[#065F46] font-semibold text-[11px]">Status: Verified & Cleared ✓</p>
          </div>
        </div>

        <div class="bg-[#F8F6F1] p-4 rounded-2xl border border-[#ECEAE4]">
          <div class="flex justify-between text-xs font-bold text-[#141F1E] pb-2 border-b border-[#ECEAE4]">
            <span>Description</span>
            <span>Allocation</span>
            <span>Total</span>
          </div>
          <div class="flex justify-between text-xs py-2 text-[#334E4B]">
            <span>${txn.type}</span>
            <span>${txn.allocatedTo}</span>
            <span class="font-bold text-[#141F1E]">${txn.currency}${txn.amount}</span>
          </div>
        </div>

        <div class="flex justify-between items-center text-sm font-bold text-[#141F1E] pt-2">
          <span>Total Settled:</span>
          <span class="text-xl text-[#0E4D45]">${txn.currency}${txn.amount}.00</span>
        </div>
      </div>

      <!-- Receipt Footer -->
      <div class="pt-6 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-12 h-12 rounded-full border-2 border-dashed border-[#0E4D45] flex items-center justify-center text-[9px] font-bold text-[#0E4D45] rotate-[-12deg]">
            SEAL OF ACADEMY
          </div>
          <span class="text-[11px] text-[#7A8684]">Digitally verified FIFO ledger transaction</span>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="window.print()" class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-full bg-[#FFFFFF] border border-[#ECEAE4] text-[#141F1E] hover:bg-[#F8F6F1] transition-colors">
            <svg class="w-3.5 h-3.5 text-[#7A8684]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
            <span>Print Receipt</span>
          </button>
          <button onclick="closeReceiptModal()" class="px-4 py-2 text-xs font-bold rounded-full bg-[#0E4D45] text-white hover:bg-[#14534B]">
            Close
          </button>
        </div>
      </div>
    </div>
  `;

  modal.classList.add('active');
}

function closeReceiptModal() {
  const modal = document.getElementById('receipt-modal');
  if (modal) modal.classList.remove('active');
}

function simulateJoinRoom(classId) {
  showToastNotification(`Connecting to secure encrypted Quran Classroom (${classId})...`);
}

function showToastNotification(message, type = 'success') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-[9999] flex flex-col gap-2.5 pointer-events-none';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto bg-white border border-[#ECEAE4] text-[#141F1E] shadow-2xl rounded-2xl px-4 py-3 flex items-center gap-3 transition-all duration-300 transform translate-y-8 opacity-0 max-w-sm sm:max-w-md';
  
  const icon = type === 'success' 
    ? `<div class="w-7 h-7 rounded-full bg-[#E0F2F1] text-[#0E4D45] flex items-center justify-center font-bold text-xs shrink-0 border border-[#B2DFDB]/60">✓</div>`
    : `<div class="w-7 h-7 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0 border border-blue-200">ℹ</div>`;

  toast.innerHTML = `
    ${icon}
    <div class="text-xs font-semibold text-[#141F1E] leading-relaxed flex-1">${message}</div>
    <button onclick="this.parentElement.remove()" class="text-[#7A8684] hover:text-[#141F1E] text-xs font-bold ml-1 cursor-pointer">✕</button>
  `;

  toastContainer.appendChild(toast);

  // Trigger smooth entrance animation
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-8', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
  });

  // Auto dismiss after 3.5 seconds
  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-8', 'opacity-0');
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 300);
  }, 3500);
}
const showToast = showToastNotification;

// ==========================================
// ACADEMY SETTINGS & NOTIFICATIONS CONTROLLERS
// ==========================================

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    if (AppState.settings) {
      if (AppState.settings.academyName) {
        const el = document.getElementById('setting-academy-name');
        if (el) el.value = AppState.settings.academyName;
      }
      if (AppState.settings.timezone) {
        const el = document.getElementById('setting-academy-timezone');
        if (el) el.value = AppState.settings.timezone;
      }
      if (AppState.settings.dueDay) {
        const el = document.getElementById('setting-fee-due-day');
        if (el) el.value = AppState.settings.dueDay;
      }
      if (AppState.settings.gracePeriod) {
        const el = document.getElementById('setting-fee-grace');
        if (el) el.value = AppState.settings.gracePeriod;
      }
      if (AppState.settings.feeAllocationMethod) {
        const el = document.getElementById('setting-fee-fifo');
        if (el) el.value = AppState.settings.feeAllocationMethod;
      }
      if (AppState.settings.lateFeePercentage !== undefined) {
        const el = document.getElementById('setting-late-fee');
        if (el) el.value = AppState.settings.lateFeePercentage;
      }
    }
    modal.classList.add('active');
  }
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.remove('active');
}

function saveAcademySettings() {
  const academyName = document.getElementById('setting-academy-name')?.value?.trim() || 'Quranic Skills Academy';
  const timezone = document.getElementById('setting-academy-timezone')?.value || 'GMT+5 (PKT)';
  const dueDay = document.getElementById('setting-fee-due-day')?.value || '5';
  const gracePeriod = document.getElementById('setting-fee-grace')?.value || '5';
  const feeAllocationMethod = document.getElementById('setting-fee-fifo')?.value || 'enabled';
  const lateFeePercentage = Number(document.getElementById('setting-late-fee')?.value) || 5;
  const whatsappAlerts = document.getElementById('setting-toggle-whatsapp')?.checked ?? true;
  const contactLock = document.getElementById('setting-toggle-pii')?.checked ?? true;
  const classDuration = document.getElementById('setting-class-duration')?.value || '30';
  const sabaqWindow = document.getElementById('setting-sabaq-window')?.value || '2';

  AppState.settings = {
    ...AppState.settings,
    academyName,
    timezone,
    dueDay,
    gracePeriod,
    feeAllocationMethod,
    lateFeePercentage,
    whatsappAlerts,
    contactLock,
    classDuration,
    sabaqWindow
  };
  saveCache('lms_settings', AppState.settings);
  if (typeof db !== 'undefined' && db && db.collection) {
    try {
      db.collection('settings').doc('academy_config').set(AppState.settings, { merge: true });
    } catch(e) {}
  }

  closeSettingsModal();
  showToastNotification(`\u2713 Settings Saved: ${academyName} (Due: ${dueDay}th, Late Fee: ${lateFeePercentage}%)`);
}

function getNotificationIconHtml(type) {
  if (type === 'fee') {
    return `<div class="w-8 h-8 rounded-lg bg-[#E0F2F1] text-[#0E4D45] flex items-center justify-center flex-shrink-0">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
    </div>`;
  }
  if (type === 'student') {
    return `<div class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"/></svg>
    </div>`;
  }
  if (type === 'teacher') {
    return `<div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center flex-shrink-0">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5"/></svg>
    </div>`;
  }
  if (type === 'notice') {
    return `<div class="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/></svg>
    </div>`;
  }
  if (type === 'trial') {
    return `<div class="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center flex-shrink-0">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/></svg>
    </div>`;
  }
  return `<div class="w-8 h-8 rounded-lg bg-[#E0F2F1] text-[#0E4D45] flex items-center justify-center flex-shrink-0">
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
  </div>`;
}

function openNotificationsModal() {
  const fullModal = document.getElementById('full-activity-log-modal');
  if (fullModal) {
    openFullActivityLogModal();
    return;
  }
  const modal = document.getElementById('notifications-modal');
  if (modal) {
    const list = document.getElementById('notifications-modal-list');
    if (list) {
      if (!Array.isArray(SYSTEM_NOTIFICATIONS) || SYSTEM_NOTIFICATIONS.length === 0) {
        list.innerHTML = `
          <div class="py-10 text-center flex flex-col items-center justify-center">
            <div class="w-10 h-10 rounded-full bg-[#E8EFEE] text-[#0E4D45] flex items-center justify-center mb-2.5">
              <svg class="w-5 h-5 text-[#0E4D45]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
            </div>
            <p class="text-xs font-semibold text-[#141F1E]">No new notifications</p>
            <p class="text-[11px] text-[#7A8684] mt-0.5">Live operational logs, fee alerts, and trial requests will appear here.</p>
          </div>
        `;
      } else {
        list.innerHTML = SYSTEM_NOTIFICATIONS.map(n => `
          <div class="p-3.5 rounded-xl ${n.unread ? 'bg-[#F8F6F1] border border-[#ECEAE4]' : 'bg-white border border-[#ECEAE4]'} flex items-start gap-3">
            ${getNotificationIconHtml(n.type)}
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <span class="font-bold text-[#141F1E] text-xs">${n.title}</span>
                <span class="text-[10px] text-[#7A8684] shrink-0 font-medium">${n.time || ''}</span>
              </div>
              <p class="text-[11px] text-[#7A8684] mt-1 leading-snug">${n.desc}</p>
              ${(n.amount || n.receiptNo) ? `
                <div class="flex items-center gap-2 mt-2">
                  ${n.amount ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#E8EFEE] text-[#0E4D45]">Amount: ${n.amount}</span>` : ''}
                  ${n.receiptNo ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[#F1EFEA] text-[#141F1E]">Receipt #${n.receiptNo}</span>` : ''}
                </div>
              ` : ''}
            </div>
          </div>
        `).join('');
      }
    }
    modal.classList.add('active');
  }
}
window.openNotificationsModal = openNotificationsModal;

function closeNotificationsModal() {
  const modal = document.getElementById('notifications-modal');
  if (modal) modal.classList.remove('active');
}
window.closeNotificationsModal = closeNotificationsModal;

/**
 * Seeds and preserves baseline academy data (only runs once on virgin database)
 */
function seedRequiredAcademyData() {
  if (typeof isAcademyAlreadySeeded === 'function' && isAcademyAlreadySeeded()) return;
  if (typeof checkAndSeedInitialAcademyData === 'function') {
    checkAndSeedInitialAcademyData().then(() => {
      reconcileStudentsWithPaymentLedger();
      renderApp();
    }).catch(() => {});
  }
}
window.seedRequiredAcademyData = seedRequiredAcademyData;
window.checkAndSeedInitialAcademyData = checkAndSeedInitialAcademyData;

// Initial Boot
document.addEventListener('DOMContentLoaded', () => {
  // Fast first paint: render immediately from the local cache. The cloud
  // seed check used to be awaited here, and its Firestore .get() calls
  // (long-polling, no timeout) left the page blank with a spinner for
  // ~3.5 minutes when Firestore was slow/unreachable. It now runs in the
  // background (itself time-boxed to 8s per read) and re-renders when done.
  reconcileStudentsWithPaymentLedger();
  seedInitialActivityNotifications();
  updateHeaderDateDisplay();
  if (window.location.hash) {
    const hash = window.location.hash.replace('#', '');
    if (['dashboard', 'fee-matrix', 'students', 'teachers', 'trials-notices', 'library'].includes(hash)) {
      AppState.activeNav = hash;
    }
  }
  renderApp();
  // Load exchange rates (local cache, then Firestore settings/currency)
  // and run the monthly auto-update check once. PKR figures render from
  // the seeded defaults meanwhile, so the Dashboard is never blocked.
  if (!currencySettingsLoaded && !currencySettingsLoading) {
    currencySettingsLoading = true;
    loadCurrencySettings().catch(function () {}).finally(function () {
      currencySettingsLoaded = true;
      currencySettingsLoading = false;
      renderApp();
    });
  }
  updateRolePillUI();
  renderNotificationsDropdownContent();
  // One-time repair of the two wrong teacher countries (Basit/Saad saved
  // as Pakistan) in the local cache; the teachers listener repairs the
  // cloud copy again when it arrives.
  repairTeacherCountries();
  setupFirestoreRealtimeListeners();
  if (typeof checkAndSeedInitialAcademyData === 'function') {
    checkAndSeedInitialAcademyData()
      .catch((e) => console.warn('[Seed] Background seed check failed:', e && e.message))
      .finally(() => {
        reconcileStudentsWithPaymentLedger();
        renderApp();
      });
  }
});

