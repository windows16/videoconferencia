/**
 * calendar.js
 * Interacciones del Dashboard de Google Meet:
 * - Selector semanal interactivo
 * - Modal de Configuración de periféricos (Audio y Video)
 * - Modal de Programación de reuniones
 * - Menú desplegable '+ Nuevo'
 * - Validación y unión por código
 */

document.addEventListener('DOMContentLoaded', () => {
  initModals();
  initNewMeetingMenu();
  initJoinInput();
  initCopyButtons();
});

// --------------------------------------------------------------------------
// Menú "+ Nuevo" (Crear reunión rápida, instantánea o programar)
// --------------------------------------------------------------------------
function initNewMeetingMenu() {
  const btnNew = document.getElementById('btnNewMeeting');
  const btnNewEmpty = document.getElementById('btnNewMeetingEmpty');
  const menu = document.getElementById('newMeetingMenu');

  function toggleMenu(e) {
    e.stopPropagation();
    if (menu) menu.classList.toggle('show');
  }

  if (btnNew) btnNew.addEventListener('click', toggleMenu);
  if (btnNewEmpty) btnNewEmpty.addEventListener('click', toggleMenu);

  document.addEventListener('click', (e) => {
    if (menu && menu.classList.contains('show') && !menu.contains(e.target)) {
      menu.classList.remove('show');
    }
  });

  // Opción 1: Crear reunión para más tarde
  const actionCreateLater = document.getElementById('actionCreateLater');
  if (actionCreateLater) {
    actionCreateLater.addEventListener('click', async (e) => {
      e.preventDefault();
      menu.classList.remove('show');
      try {
        const resp = await fetch('/api/meetings/instant/', {
          method: 'POST',
          headers: {
            'X-CSRFToken': getCsrfToken(),
            'Content-Type': 'application/json'
          }
        });
        const data = await resp.json();
        if (data.success) {
          showShareModal(data.code, `${window.location.origin}/prejoin/${data.code}/`);
        }
      } catch (err) {
        alert("Error al crear reunión: " + err);
      }
    });
  }

  // Opción 2: Iniciar una reunión instantánea
  const actionInstant = document.getElementById('actionInstant');
  if (actionInstant) {
    actionInstant.addEventListener('click', async (e) => {
      e.preventDefault();
      menu.classList.remove('show');
      try {
        const resp = await fetch('/api/meetings/instant/', {
          method: 'POST',
          headers: {
            'X-CSRFToken': getCsrfToken(),
            'Content-Type': 'application/json'
          }
        });
        const data = await resp.json();
        if (data.success) {
          window.location.href = data.prejoin_url;
        }
      } catch (err) {
        alert("Error al iniciar reunión instantánea: " + err);
      }
    });
  }

  // Opción 3: Programar en calendario
  const actionSchedule = document.getElementById('actionSchedule');
  if (actionSchedule) {
    actionSchedule.addEventListener('click', (e) => {
      e.preventDefault();
      menu.classList.remove('show');
      openScheduleModal();
    });
  }
}

// --------------------------------------------------------------------------
// Input de código y botón "Unirse"
// --------------------------------------------------------------------------
function initJoinInput() {
  const codeInput = document.getElementById('meetCodeInput');
  const btnJoin = document.getElementById('btnJoinMeeting');

  if (!codeInput || !btnJoin) return;

  function updateJoinState() {
    const val = codeInput.value.trim();
    btnJoin.disabled = val.length < 3;
  }

  codeInput.addEventListener('input', updateJoinState);
  codeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !btnJoin.disabled) {
      handleJoinAction();
    }
  });

  btnJoin.addEventListener('click', handleJoinAction);

  async function handleJoinAction() {
    const code = codeInput.value.trim();
    if (!code) return;

    try {
      btnJoin.innerText = "Verificando...";
      btnJoin.disabled = true;
      const resp = await fetch(`/api/meetings/check/?code=${encodeURIComponent(code)}`);
      const data = await resp.json();

      if (data.exists) {
        window.location.href = data.join_url;
      } else {
        alert(data.message || "El código ingresado no corresponde a ninguna reunión activa.");
      }
    } catch (e) {
      alert("Error al verificar la reunión: " + e);
    } finally {
      btnJoin.innerText = "Unirse";
      updateJoinState();
    }
  }
}

// --------------------------------------------------------------------------
// Modales: Configuración (Audio / Video) y Programación
// --------------------------------------------------------------------------
function initModals() {
  const settingsModal = document.getElementById('settingsModal');
  const scheduleModal = document.getElementById('scheduleModal');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const closeScheduleBtn = document.getElementById('closeScheduleBtn');

  // Abrir modal de configuración
  if (openSettingsBtn && settingsModal) {
    openSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.add('show');
      // Solicitar permisos y enumerar dispositivos
      if (window.deviceManager) {
        window.deviceManager.requestPermissions().then(() => {
          window.deviceManager.startAudioMeter();
        });
      }
    });
  }

  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.remove('show');
      if (window.deviceManager) {
        window.deviceManager.stopAudioMeter();
        window.deviceManager.stopCameraPreview();
      }
    });
  }

  // Cerrar al hacer clic en el backdrop
  [settingsModal, scheduleModal].forEach(modal => {
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('show');
          if (window.deviceManager) {
            window.deviceManager.stopAudioMeter();
            window.deviceManager.stopCameraPreview();
          }
        }
      });
    }
  });

  // Pestañas de configuración: Audio / Video
  const tabAudioBtn = document.getElementById('tabAudioBtn');
  const tabVideoBtn = document.getElementById('tabVideoBtn');
  const contentAudio = document.getElementById('settingsContentAudio');
  const contentVideo = document.getElementById('settingsContentVideo');

  if (tabAudioBtn && tabVideoBtn) {
    tabAudioBtn.addEventListener('click', () => {
      tabAudioBtn.classList.add('active');
      tabVideoBtn.classList.remove('active');
      contentAudio.style.display = 'block';
      contentVideo.style.display = 'none';

      if (window.deviceManager) {
        window.deviceManager.stopCameraPreview();
        window.deviceManager.startAudioMeter();
      }
    });

    tabVideoBtn.addEventListener('click', () => {
      tabVideoBtn.classList.add('active');
      tabAudioBtn.classList.remove('active');
      contentAudio.style.display = 'none';
      contentVideo.style.display = 'block';

      if (window.deviceManager) {
        window.deviceManager.stopAudioMeter();
        window.deviceManager.startCameraPreview();
      }
    });
  }

  // Cerrar modal de programación
  if (closeScheduleBtn && scheduleModal) {
    closeScheduleBtn.addEventListener('click', () => {
      scheduleModal.classList.remove('show');
    });
  }

  // Procesar envío del formulario de programación
  const scheduleForm = document.getElementById('scheduleMeetingForm');
  if (scheduleForm) {
    scheduleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(scheduleForm);
      try {
        const resp = await fetch('/api/meetings/schedule/', {
          method: 'POST',
          headers: {
            'X-CSRFToken': getCsrfToken()
          },
          body: formData
        });
        const data = await resp.json();
        if (data.success) {
          scheduleModal.classList.remove('show');
          // Redirigir a la fecha de la reunión programada
          window.location.href = `/?date=${data.scheduled_date}`;
        } else {
          alert("Por favor verifica los datos del formulario: " + JSON.stringify(data.errors));
        }
      } catch (err) {
        alert("Error al programar la reunión: " + err);
      }
    });
  }
}

function openScheduleModal() {
  const scheduleModal = document.getElementById('scheduleModal');
  if (scheduleModal) scheduleModal.classList.add('show');
}

// --------------------------------------------------------------------------
// Copiar enlaces y helpers
// --------------------------------------------------------------------------
function initCopyButtons() {
  document.querySelectorAll('.btn-copy-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const url = btn.dataset.url;
      if (url) {
        navigator.clipboard.writeText(url).then(() => {
          const orig = btn.innerText;
          btn.innerText = "¡Copiado!";
          setTimeout(() => { btn.innerText = orig; }, 1500);
        });
      }
    });
  });
}

function showShareModal(code, link) {
  const shareModal = document.getElementById('shareModal');
  if (shareModal) {
    document.getElementById('shareMeetingCode').innerText = code;
    document.getElementById('shareMeetingLink').value = link;
    shareModal.classList.add('show');
    
    document.getElementById('btnCopyShareLink').onclick = () => {
      navigator.clipboard.writeText(link);
      alert("Enlace seguro copiado al portapapeles");
    };
    document.getElementById('btnCloseShareModal').onclick = () => {
      shareModal.classList.remove('show');
    };
  } else {
    navigator.clipboard.writeText(link);
    alert(`Reunión creada con éxito!\nCódigo: ${code}\nEnlace copiado al portapapeles: ${link}`);
  }
}

function getCsrfToken() {
  const cookieValue = document.cookie
    .split('; ')
    .find(row => row.startsWith('csrftoken='))
    ?.split('=')[1];
  return cookieValue || '';
}
