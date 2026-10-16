document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('statusBadge');
  const projectInfo = document.getElementById('projectInfo');
  const btnGetSelection = document.getElementById('btnGetSelection');
  const selectionOutput = document.getElementById('selectionOutput');

  let API = null;

  try {
    if (window.TrimbleConnectWorkspace) {
      API = await window.TrimbleConnectWorkspace.connect(window.parent, (event, args) => {
        console.log("Trimble Connect event:", event, args);
      });

      statusBadge.textContent = "Ansluten";
      statusBadge.classList.add("connected");

      // Hämta aktuell projektinformation
      if (API.project) {
        const project = await API.project.getProject();
        projectInfo.innerHTML = `
          <p><strong>Projektnamn:</strong> ${project.name || 'Okänt'}</p>
          <p><strong>Projekt-ID:</strong> ${project.id || 'Saknas'}</p>
        `;
      }
    } else {
      statusBadge.textContent = "Fristående läge (ej i TC)";
      projectInfo.textContent = "Körs utanför Trimble Connect 3D-visare.";
    }
  } catch (err) {
    console.error("Kunde inte ansluta till Trimble Connect API:", err);
    statusBadge.textContent = "Anslutningsfel";
    projectInfo.textContent = "Fel vid anslutning: " + err.message;
  }

  if (btnGetSelection) {
    btnGetSelection.addEventListener('click', async () => {
      if (!API || !API.viewer) {
        selectionOutput.textContent = "Viewer API är inte tillgängligt.";
        return;
      }
      try {
        const selection = await API.viewer.getSelection();
        selectionOutput.textContent = JSON.stringify(selection, null, 2);
      } catch (e) {
        selectionOutput.textContent = "Kunde inte hämta markering: " + e.message;
      }
    });
  }
});
