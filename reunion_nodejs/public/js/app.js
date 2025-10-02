let socket;
let peer;
let monStreamLocal;
let streamPartageEcran;
let connexionsPeers = new Map();
let audioActif = true;
let videoActif = true;
let partageEcranActif = false;
let mainLevee = false;
let monVideo;
let videosDistantes;
let listeParticipants;
let boutonAudio;
let boutonVideo;
let boutonPartageEcran;
let boutonQuitter;
let boutonMain;
let messageStatut;
let videoPartageEcran;
let partageEcranContainer;

function initialiserReunion(idReunion, nomUtilisateur) {
    console.log('Initialisation de la réunion:', idReunion, nomUtilisateur);

    obtenirElementsDOM();

    configurerGestionnaires();

    initialiserSocket();

    initialiserPeer(idReunion, nomUtilisateur);

    obtenirStreamLocal();
}

function obtenirElementsDOM() {
    monVideo = document.getElementById('monVideo');
    videosDistantes = document.getElementById('videosDistantes');
    listeParticipants = document.getElementById('listeParticipants');
    boutonAudio = document.getElementById('boutonAudio');
    boutonVideo = document.getElementById('boutonVideo');
    boutonPartageEcran = document.getElementById('boutonPartageEcran');
    boutonQuitter = document.getElementById('boutonQuitter');
    boutonMain = document.getElementById('boutonMain');
    messageStatut = document.getElementById('messageStatut');
    videoPartageEcran = document.getElementById('videoPartageEcran');
    partageEcranContainer = document.getElementById('partageEcranContainer');
    
    if (!videosDistantes) {
        console.error("Élément 'videosDistantes' introuvable dans le DOM");
    }
}

function configurerGestionnaires() {
    boutonAudio.addEventListener('click', function () {
        audioActif = !audioActif;

        if (monStreamLocal) {
            const pistesAudio = monStreamLocal.getAudioTracks();
            pistesAudio.forEach(piste => piste.enabled = audioActif);
        }

        mettreAJourBoutonAudio();
        socket.emit('basculer-audio', {
            idReunion: window.idReunionGlobal,
            audioActive: audioActif
        });
    });

    boutonVideo.addEventListener('click', function() {
        videoActif = !videoActif;

        if (monStreamLocal) {
            const pistesVideo = monStreamLocal.getVideoTracks();
            pistesVideo.forEach(piste => piste.enabled = videoActif);
        }

        mettreAJourBoutonVideo();
        socket.emit('basculer-video', {
            idReunion: window.idReunionGlobal,
            videoActive: videoActif
        });
    });

    boutonMain.addEventListener('click', function() {
        if (mainLevee) {
            baisserLaMain();
        } else {
            leverLaMain();
        }
    });

    boutonPartageEcran.addEventListener('click', function() {
        if (partageEcranActif) {
            arreterPartageEcran();
        } else {
            commencerPartageEcran();
        }
    });

    boutonQuitter.addEventListener('click', function() {
        if (confirm("Êtes-vous sûr de vouloir quitter la réunion ?")) {
            window.location.href = '/';
        }
    });
}

function initialiserSocket() {
    socket = io();

    socket.on('nouvel-utilisateur', function(data) {
        console.log('Nouvel utilisateur connecté:', data);
        afficherMessage(`${data.nom} a rejoint la réunion`);

        setTimeout(() => {
            appellerUtilisateur(data.peerId, data.nom);
        }, 1000)
    });

    socket.on('participants-existants', function(participants) {
        console.log('Participants existants:', participants);

        participants.forEach(participant => {
            setTimeout(() => {
                appellerUtilisateur(participant.peerId, participant.nom);
            }, 1000);
        });
    });

    socket.on('mise-a-jour-participants', function(participants) {
        mettreAJourListeParticipants(participants);
    });

    socket.on('utilisateur-deconnecte', function(data) {
        console.log('Utilisateur déconnecté:', data);

        if (connexionsPeers.has(data.peerId)) {
            connexionsPeers.get(data.peerId).close();
            connexionsPeers.delete(data.peerId);
        }

        const videoElement = document.getElementById(`video-${data.peerId}`);
        if (videoElement) {
            videoElement.remove();
        }

        afficherMessage("Un participant a quitté la réunion");
    });

    socket.on('partage-ecran-commence', function(data) {
        afficherMessage(`${data.utilisateur} partage son écran`);
    });

    socket.on('partage-ecran-arrete', function() {
        afficherMessage("Le partage d'écran s'est arrêté");
        masquerPartageEcran();
    });

    socket.on('utilisateur-audio-change', function(data) {
        console.log("Changement audio utilisateur:", data);
    });

    socket.on('utilisateur-video-change', function(data) {
        console.log("Changement video utilisateur:", data);
    });

    socket.on('utilisateur-leve-main', function(data) {
        console.log('Utilisateur a levé la main:', data);
        afficherMessage(`✋ ${data.nom} a levé la main`);
    });

    socket.on('utilisateur-baisse-main', function(data) {
        console.log('Utilisateur a baissé la main:', data);
        afficherMessage(`${data.nom} a baissé la main`);
    });
}

function initialiserPeer(idReunion, nomUtilisateur) {
    peer = new Peer(undefined, {
        host: window.location.hostname,
        port: 9000,
        path: '/myapp',
        secure: window.location.protocol === 'https:',
        debug: 3
    });

    peer.on('open', function(peerId) {
        console.log('PeerJs connecté avec ID:', peerId);

        window.idReunionGlobal = idReunion;

        socket.emit('rejoindre-reunion', {
            idReunion: idReunion,
            nomUtilisateur: nomUtilisateur,
            peerId: peerId
        });
    });

    peer.on('call', function(appel) {
        console.log('Appel entrant de:', appel.peer);

        if (!monStreamLocal) {
            console.log("Stream local non disponible, attente...");
            setTimeout(() => {
                if (monStreamLocal) {
                    appel.answer(monStreamLocal);
                }
            }, 1000);
            return;
        }

        appel.answer(monStreamLocal);

        appel.on('stream', function(streamDistant) {
            console.log("Stream reçu d'un appel entrant:", appel.peer);
            ajouterVideoDistance(appel.peer, streamDistant);
        });

        connexionsPeers.set(appel.peer, appel);

        appel.on('close', function() {
            console.log('Appel fermé avec:', appel.peer);
            connexionsPeers.delete(appel.peer);
            retirerVideoDistance(appel.peer);
        });

        appel.on('error', function(erreur) {
            console.error("Erreur dans l'appel entrant:", erreur);
        });
    });

    peer.on('error', function(erreur) {
        console.error('Erreur PeerJs', erreur);
        afficherMessage('Erreur de connexion: ' + erreur.message);
    });
}

function obtenirStreamLocal() {
    navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
    })
    .then(function(stream) {
        monStreamLocal = stream;
        monVideo.srcObject = stream;

        console.log('Stream local obtenu');
    })
    .catch(function(erreur) {
        console.log("Erreur lors de l'obtention du stream local", erreur);
        afficherMessage("Impossible d'accéder à la caméra/microphone");
    });
}

function appellerUtilisateur(peerId, nom) {
    console.log("Appel vers:", peerId, nom);

    if (connexionsPeers.has(peerId)) {
        console.log("Connexion déjà établie avec:", peerId);
        return;
    }

    if (!monStreamLocal) {
        console.log("Stream local pas encore prêt, réessai dans 1 seconde");
        setTimeout(() => appellerUtilisateur(peerId, nom), 1000);
        return;
    }

    const appel = peer.call(peerId, monStreamLocal);

    appel.on('stream', function(streamDistant) {
        console.log("Stream reçu de:", peerId);
        ajouterVideoDistance(peerId, streamDistant, nom);
    });

    appel.on('error', function(erreur) {
        console.error("Erreur lors de l'appel:", erreur);
    });

    appel.on('close', function() {
        console.log('Appel fermé avec:', peerId);
        connexionsPeers.delete(peerId);
        retirerVideoDistance(peerId);
    });

    connexionsPeers.set(peerId, appel);
}

function ajouterVideoDistance(peerId, stream, nom = 'Participant') {
    console.log("Ajouter vidéo distante pour:", peerId);

    let videoContainer = document.getElementById(`video-${peerId}`);

    if (!videoContainer) {
        videoContainer = document.createElement('div');
        videoContainer.id = `video-${peerId}`;
        videoContainer.className = 'video-distante';

        const videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.srcObject = stream;

        const label = document.createElement('div');
        label.className = 'video-label';
        label.textContent = nom;

        videoContainer.appendChild(videoElement);
        videoContainer.appendChild(label);

        videosDistantes.appendChild(videoContainer);
    } else {
        const videoElement = videoContainer.querySelector('video');
        videoElement.srcObject = stream;
    }
}

function retirerVideoDistance(peerId) {
    const videoContainer = document.getElementById(`video-${peerId}`);
    if (videoContainer) {
        videoContainer.remove();
    }
}

function commencerPartageEcran() {
    navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
    })
    .then(function(stream) {
        streamPartageEcran = stream;

        videoPartageEcran.srcObject = stream;
        partageEcranContainer.style.display = 'block';

        partageEcranActif = true;
        boutonPartageEcran.textContent = 'Arrêter le partage';

        socket.emit('commencer-partage-ecran', {
            idReunion: window.idReunionGlobal
        });

        connexionsPeers.forEach((connexion, peerId) => {
            const sender = connexion.peerConnection.getSenders().find(s => 
                s.track && s.track.kind === 'video'
            );

            if (sender) {
                sender.replaceTrack(stream.getVideoTracks()[0]);
            }
        });

        stream.getVideoTracks()[0].onended = function() {
            arreterPartageEcran();
        };

        afficherMessage("Partage d'écran démarré");
    })
    .catch(function(erreur) {
        console.error("Erreur de partage d'écran:", erreur);
        afficherMessage("Impossible de partager l'écran");
    });
}

function arreterPartageEcran() {
    if (streamPartageEcran) {
        streamPartageEcran.getTracks().forEach(track => track.stop());
        streamPartageEcran = null;
    }

    partageEcranContainer.style.display = 'none';
    partageEcranActif = false;
    boutonPartageEcran.textContent = "Partager l'écran";

    if (monStreamLocal) {
        connexionsPeers.forEach((connexion, peerId) => {
            const sender = connexion.peerConnection.getSenders().find(s =>
                s.track && s.track.kind === 'video'
            );

            if (sender && monStreamLocal.getVideoTracks()[0]) {
                sender.replaceTrack(monStreamLocal.getVideoTracks()[0]);
            }
        });
    }

    socket.emit('arreter-partage-ecran', {
        idReunion: window.idReunionGlobal
    });

    afficherMessage("Partage d'écran arrêté");
}

function masquerPartageEcran() {
    partageEcranContainer.style.display = 'none';
}

function leverLaMain() {
    mainLevee = true;
    boutonMain.textContent = "Baisser la main";
    boutonMain.className = "bouton controle main-levee";
    
    socket.emit('lever-la-main', {
        idReunion: window.idReunionGlobal
    });
    
    afficherMessage("✋ Vous avez levé la main");
}

function baisserLaMain() {
    mainLevee = false;
    boutonMain.textContent = "Lever la main";
    boutonMain.className = "bouton controle";
    
    socket.emit('baisser-la-main', {
        idReunion: window.idReunionGlobal
    });
}

function mettreAJourBoutonAudio() {
    if (audioActif) {
        boutonAudio.textContent = "Audio Activé";
        boutonAudio.className = "bouton contrôle audio-actif";
    } else {
        boutonAudio.textContent = "Audio Coupé";
        boutonAudio.className = "bouton contrôle audio-inactif";
    }
}

function mettreAJourBoutonVideo() {
    if (videoActif) {
        boutonVideo.textContent = "Vidéo Activée";
        boutonVideo.className = "bouton contrôle video-actif";
    } else {
        boutonVideo.textContent = "Vidéo Coupée";
        boutonVideo.className = "bouton contrôle video-inactif";
    }
}

function mettreAJourListeParticipants(participants) {
    listeParticipants.innerHTML = '';

    participants.forEach(participant => {
        const item = document.createElement('div');
        item.className = 'participant-item';
        
        if (participant.mainLevee) {
            item.classList.add('main-levee');
        }

        const nomContainer = document.createElement('div');
        nomContainer.className = 'participant-nom-container';

        const nom = document.createElement('span');
        nom.className = 'participant-nom';
        nom.textContent = participant.nom;

        // Badge main levée plus visible
        if (participant.mainLevee) {
            const badgeMain = document.createElement('div');
            badgeMain.className = 'badge-main-levee';
            badgeMain.innerHTML = '✋';
            badgeMain.title = 'Main levée';
            nomContainer.appendChild(badgeMain);
        }

        nomContainer.appendChild(nom);

        const statut = document.createElement('div');
        statut.className = 'participant-statut';

        const badgeAudio = document.createElement('div');
        badgeAudio.className = `statut-badge ${participant.audioActive ? 'audio-actif' : 'audio-inactif'}`;
        badgeAudio.title = participant.audioActive ? 'Audio activée' : 'Audio coupée';

        const badgeVideo = document.createElement('div');
        badgeVideo.className = `statut-badge ${participant.videoActive ? 'video-actif' : 'video-inactif'}`;
        badgeVideo.title = participant.videoActive ? 'Vidéo activée' : 'Vidéo coupée';

        statut.appendChild(badgeAudio);
        statut.appendChild(badgeVideo);

        item.appendChild(nomContainer);
        item.appendChild(statut);

        listeParticipants.appendChild(item);
    });
}

function afficherMessage(message) {
    messageStatut.textContent = message;
    messageStatut.style.display = 'block';

    setTimeout(function() {
        messageStatut.style.display = 'none';
    }, 3000)
}

window.addEventListener('beforeunload', function() {
    if (peer) {
        peer.destroy();
    }
    if (socket) {
        socket.disconnect();
    }
})