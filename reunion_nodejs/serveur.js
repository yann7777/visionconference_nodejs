const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const path = require('path');
const { PeerServer } = require('peer');

const app = express();

const options = {
    key: fs.readFileSync('certs/yannis.sn+2-key.pem'),
    cert: fs.readFileSync('certs/yannis.sn+2.pem')
};

const server = https.createServer(options, app);
const io = socketIo(server);

const peerServer = PeerServer({
    port: 9000,
    path: '/myapp',
    ssl: options,
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const reunions = new Map();
const utilisateurs = new Map();

app.get('/', (req, res) => {
    res.render('index', {
        title: 'Accueil - Application de Réunion'
    });
});

app.post('/creer-reunion', (req, res) => {
    const { nomUtilisateur } = req.body;
    const idReunion = genererIdReunion();

    reunions.set(idReunion, {
        id: idReunion,
        createur: nomUtilisateur,
        participants: [],
        partageEcran: null,
        dateCreation: new Date()
    });

    res.redirect(`/reunion/${idReunion}?nom=${encodeURIComponent(nomUtilisateur)}`);
});

app.post('/rejoindre-reunion', (req, res) => {
    const { idReunion, nomUtilisateur } = req.body;

    if (reunions.has(idReunion)) {
        res.redirect(`/reunion/${idReunion}?nom=${encodeURIComponent(nomUtilisateur)}`);
    } else {
        res.render('index', {
            title: 'Accueil - Application de Réunion',
            erreur: 'Réunion introuvable'
        });
    }
});

app.get('/reunion/:id', (req, res) => {
    const idReunion = req.params.id;
    const nomUtilisateur = req.query.nom;

    if (!reunions.has(idReunion)) {
        return res.redirect('/?erreur=reunion-introuvable');
    }

    res.render('reunion', {
        title: `Réunion ${idReunion}`,
        idReunion,
        nomUtilisateur,
        reunion: reunions.get(idReunion)
    });
});

io.on('connection', (socket) => {
    console.log("Nouvelle connexion:", socket.id);

    socket.on('rejoindre-reunion', (data) => {
        const { idReunion, nomUtilisateur, peerId } = data;

        if (reunions.has(idReunion)) {
            const reunion = reunions.get(idReunion);

            const utilisateurExistant = reunion.participants.find(p => p.peerId === peerId);
            if (utilisateurExistant) {
                console.log("Utilisateur déjà dans la réunion:", peerId);
                return;
            }

            const utilisateur = {
                id: socket.id,
                peerId,
                nom: nomUtilisateur,
                audioActive: true,
                videoActive: true,
                mainLevee: false,
                timestampMainLevee: null
            };

            reunion.participants.push(utilisateur);
            utilisateurs.set(socket.id, utilisateur);

            socket.join(idReunion);
            
            console.log(`Utilisateur ${nomUtilisateur} (${peerId}) a rejoint la réunion ${idReunion}`);
            console.log(`Nombre de participants: ${reunion.participants.length}`);

            io.to(idReunion).emit('nouvel-utilisateur', {
                peerId,
                nom: nomUtilisateur
            });

            const participantsExistants = reunion.participants
                .filter(p => p.peerId !== peerId)
                .map(p => ({ peerId: p.peerId, nom: p.nom }));

            console.log(`Envoi de ${participantsExistants.length} participants existants à ${nomUtilisateur}`);
            socket.emit('participants-existants', participantsExistants);

            socket.to(idReunion).emit('mise-a-jour-participants',
                reunion.participants.map(p => ({
                    nom: p.nom,
                    audioActive: p.audioActive,
                    videoActive: p.videoActive,
                    mainLevee: p.mainLevee,
                    peerId: p.peerId
                }))
            );
        } else {
            console.log("Réunion introuvable:", idReunion);
            socket.emit('erreur-reunion', { message: 'Réunion introuvable' });
        }
    });

    socket.on('commencer-partage-ecran', (data) => {
        const { idReunion } = data;
        const utilisateur = utilisateurs.get(socket.id);

        if (reunions.has(idReunion) && utilisateur) {
            const reunion = reunions.get(idReunion);
            reunion.partageEcran = {
                utilisateur: utilisateur.nom,
                peerId: utilisateur.peerId
            };

            io.to(idReunion).emit('partage-ecran-commence', {
                utilisateur: utilisateur.nom,
                peerId: utilisateur.peerId
            });
        }
    });

    socket.on('arreter-partage-ecran', (data) => {
        const { idReunion } = data;

        if (reunions.has(idReunion)) {
            const reunion = reunions.get(idReunion);
            reunion.partageEcran = null;
            io.to(idReunion).emit('partage-ecran-arrete');
        }
    });

    socket.on('basculer-audio', (data) => {
        const { idReunion, audioActive } = data;
        const utilisateur = utilisateurs.get(socket.id);

        if (utilisateur) {
            utilisateur.audioActive = audioActive;
            socket.to(idReunion).emit('utilisateur-audio-change', {
                peerId: utilisateur.peerId,
                audioActive
            });

            const reunion = reunions.get(idReunion);
            if (reunion) {
                io.to(idReunion).emit('mise-a-jour-participants',
                    reunion.participants.map(p => ({
                        nom: p.nom,
                        audioActive: p.audioActive,
                        videoActive: p.videoActive,
                        mainLevee: p.mainLevee,
                        peerId: p.peerId
                    }))
                );
            }
        }
    });

    socket.on('basculer-video', (data) => {
        const { idReunion, videoActive } = data;
        const utilisateur = utilisateurs.get(socket.id);

        if (utilisateur) {
            utilisateur.videoActive = videoActive;
            socket.to(idReunion).emit('utilisateur-video-change', {
                peerId: utilisateur.peerId,
                videoActive
            });

            const reunion = reunions.get(idReunion);
            if (reunion) {
                io.to(idReunion).emit('mise-a-jour-participants',
                    reunion.participants.map(p => ({
                        nom: p.nom,
                        audioActive: p.audioActive,
                        videoActive: p.videoActive,
                        mainLevee: p.mainLevee,
                        peerId: p.peerId
                    }))
                );
            }
        }
    });

    // lever la main
    socket.on('lever-la-main', (data) => {
        const { idReunion } = data;
        const utilisateur = utilisateurs.get(socket.id);

        if (utilisateur && reunions.has(idReunion)) {
            utilisateur.mainLevee = true;
            utilisateur.timestampMainLevee = new Date();

            socket.to(idReunion).emit('utilisateur-leve-main', {
                nom: utilisateur.nom,
                peerId: utilisateur.peerId
            });

            const reunion = reunions.get(idReunion);
            io.to(idReunion).emit('mise-a-jour-participants',
                reunion.participants.map(p => ({
                    nom: p.nom,
                    audioActive: p.audioActive,
                    videoActive: p.videoActive,
                    mainLevee: p.mainLevee,
                    peerId: p.peerId
                }))
            );
        }
    });

    // baisser la main
    socket.on('baisser-la-main', (data) => {
        const { idReunion } = data;
        const utilisateur = utilisateurs.get(socket.id);

        if (utilisateur && reunions.has(idReunion)) {
            utilisateur.mainLevee = false;
            utilisateur.timestampMainLevee = null;

            socket.to(idReunion).emit('utilisateur-baisse-main', {
                nom: utilisateur.nom,
                peerId: utilisateur.peerId
            });

            const reunion = reunions.get(idReunion);
            io.to(idReunion).emit('mise-a-jour-participants',
                reunion.participants.map(p => ({
                    nom: p.nom,
                    audioActive: p.audioActive,
                    videoActive: p.videoActive,
                    mainLevee: p.mainLevee,
                    peerId: p.peerId
                }))
            );
        }
    });

    // on récupère la personne qui a levé la main dans la réunion
    socket.on('baisser-main-utilisateur', (data) => {
        const { idReunion, peerId } = data;
        const reunion = reunions.get(idReunion);

        if (reunion) {
            const utilisateur = reunion.participants.find(p => p.peerId === peerId);
            if (utilisateur) {
                utilisateur.mainLevee = false;
                utilisateur.timestampMainLevee = null;

                io.to(idReunion).emit('utilisateur-baisse-main', {
                    nom: utilisateur.nom,
                    peerId: utilisateur.peerId
                });

                io.to(idReunion).emit('mise-a-jour-participants',
                    reunion.participants.map(p => ({
                        nom: p.nom,
                        audioActive: p.audioActive,
                        videoActive: p.videoActive,
                        mainLevee: p.mainLevee,
                        peerId: p.peerId
                    }))
                );
            }
        }
    });

    socket.on('disconnect', () => {
        const utilisateur = utilisateurs.get(socket.id);

        if (utilisateur) {
            for (const [idReunion, reunion] of reunions) {
                const index = reunion.participants.findIndex(p => p.id === socket.id);
                if (index !== -1) {
                    reunion.participants.splice(index, 1);

                    socket.to(idReunion).emit('utilisateur-deconnecte', {
                        peerId: utilisateur.peerId
                    });

                    io.to(idReunion).emit('mise-a-jour-participants',
                        reunion.participants.map(p => ({
                            nom: p.nom,
                            audioActive: p.audioActive,
                            videoActive: p.videoActive,
                            mainLevee: p.mainLevee,
                            peerId: p.peerId
                        }))
                    );

                    if (reunion.participants.length === 0) {
                        reunions.delete(idReunion);
                    }

                    break;
                }
            }
            utilisateurs.delete(socket.id);
        }
    });
});

function genererIdReunion() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur démarré sur https://localhost:${PORT}`);
    console.log(`Serveur PeerJs démarré sur le port 9000`);
});