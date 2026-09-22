import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat';

await RAPIER.init();

const container = document.getElementById('scene-container');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07111f);

const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1500
);

camera.position.set(0, 4, 8);

const renderer = new THREE.WebGLRenderer({
    antialias: true
});

renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, 2)
);

renderer.setSize(
    window.innerWidth,
    window.innerHeight
);

renderer.shadowMap.enabled = true;

container.appendChild(renderer.domElement);

scene.add(
    new THREE.HemisphereLight(
        0xcfe8ff,
        0x202020,
        1.7
    )
);

const sun = new THREE.DirectionalLight(
    0xffffff,
    3
);

sun.position.set(-10, 25, 10);
sun.castShadow = true;

scene.add(sun);

const controls = new OrbitControls(
    camera,
    renderer.domElement
);

controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 3;
controls.maxDistance = 14;

const physicsWorld = new RAPIER.World({
    x: 0,
    y: -9.81,
    z: 0
});

const loader = new GLTFLoader();

const timer = new THREE.Timer();


// ============================================================
// PASO 4 - CARGAR LA CIUDAD Y CREAR COLLIDERS
// ============================================================

function createStaticTrimesh(mesh) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;

    if (!position) return;

    mesh.updateWorldMatrix(true, false);

    const v = new Float32Array(
        position.count * 3
    );

    const point = new THREE.Vector3();

    for (let i = 0; i < position.count; i++) {
        point
            .fromBufferAttribute(position, i)
            .applyMatrix4(mesh.matrixWorld);

        v[i * 3] = point.x;
        v[i * 3 + 1] = point.y;
        v[i * 3 + 2] = point.z;
    }

    let indices;

    if (geometry.index) {
        indices = new Uint32Array(
            geometry.index.array
        );
    } else {
        indices = new Uint32Array(
            position.count
        );

        for (let i = 0; i < position.count; i++) {
            indices[i] = i;
        }
    }

    physicsWorld.createCollider(
        RAPIER.ColliderDesc.trimesh(
            v,
            indices
        )
    );
}

loader.load(
    './assets/models/city/scene.gltf',
    (gltf) => {
        const city = gltf.scene;

        city.traverse((child) => {
            if (!child.isMesh) return;

            child.castShadow = true;
            child.receiveShadow = true;

            createStaticTrimesh(child);
        });

        scene.add(city);
    }
);


// ============================================================
// PASO 5 - CUERPO FÍSICO DEL PERSONAJE
// ============================================================

const characterBody = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc
        .kinematicPositionBased()
        .setTranslation(0, 0.38, -6)
);

const characterCollider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.capsule(0.22, 0.14),
    characterBody
);

const characterController =
    physicsWorld.createCharacterController(0.03);

characterController.enableAutostep(
    0.35,
    0.2,
    true
);

characterController.enableSnapToGround(
    0.35
);

characterController.setApplyImpulsesToDynamicBodies(
    true
);

const keyStates = {};

document.addEventListener(
    'keydown',
    (e) => {
        keyStates[e.code] = true;
    }
);

document.addEventListener(
    'keyup',
    (e) => {
        keyStates[e.code] = false;
    }
);


// ============================================================
// PASO 6 - CARGAR PERSONAJE Y ANIMACIONES
// ============================================================

let character = null;
let mixer = null;

const actions = {};

let currentAction = null;


// ------------------------------------------------------------
// CONVERTIR ANIMACIONES A "IN PLACE"
// Evita que Walk, Run, Idle o Throw desplacen el personaje.
// El movimiento real lo controla Rapier.
// ------------------------------------------------------------

function makeClipInPlace(originalClip, hips) {

    // Trabajamos con una copia para no modificar
    // la animación original.
    const clip = originalClip.clone();

    if (!hips) {
        console.warn(
            '⚠️ No se encontró el hueso Hips.'
        );

        return clip;
    }

    // Buscamos la pista que mueve la posición
    // del hueso principal de Mixamo.
    const positionTrack = clip.tracks.find(
        (track) =>
            track.name.endsWith('.position') &&
            (
                track.name.includes('mixamorig:Hips') ||
                track.name.includes('Hips')
            )
    );

    if (!positionTrack) {
        return clip;
    }

    const values = positionTrack.values;

    // Posición original del esqueleto.
    const baseX = hips.position.x;
    const baseY = hips.position.y;
    const baseZ = hips.position.z;

    // Altura inicial de esta animación.
    const startY = values[1];

    // Cada posición contiene:
    // X, Y, Z
    for (
        let i = 0;
        i < values.length;
        i += 3
    ) {

        // Eliminamos movimiento lateral.
        values[i] = baseX;

        // Conservamos únicamente el movimiento
        // vertical natural del cuerpo.
        values[i + 1] =
            baseY +
            (values[i + 1] - startY);

        // Eliminamos movimiento hacia adelante/atrás.
        values[i + 2] = baseZ;
    }

    return clip;
}


loader.load(
    './assets/models/character/character.glb',

    (gltf) => {

        character = gltf.scene;

        // Escala que ya elegiste.
        character.scale.setScalar(0.5);

        character.traverse(
            (child) => {

                if (child.isMesh) {
                    child.castShadow = true;
                }

            }
        );

        scene.add(character);


        // ----------------------------------------------------
        // ANIMATION MIXER
        // ----------------------------------------------------

        mixer = new THREE.AnimationMixer(
            character
        );


        // ----------------------------------------------------
        // BUSCAR EL HUESO PRINCIPAL
        // ----------------------------------------------------

        const hips =
            character.getObjectByName(
                'mixamorig:Hips'
            );

        if (hips) {

            console.log(
                '✅ Hips encontrado:',
                hips.name
            );

        } else {

            console.warn(
                '⚠️ No se encontró mixamorig:Hips'
            );

        }


        // ----------------------------------------------------
        // PREPARAR ANIMACIONES
        // ----------------------------------------------------

        for (
            const originalClip
            of gltf.animations
        ) {

            const name =
                originalClip.name.toLowerCase();

            // Convertimos la animación a
            // movimiento "in place".
            const clip =
                makeClipInPlace(
                    originalClip,
                    hips
                );

            actions[name] =
                mixer.clipAction(clip);

            console.log(
                `🎬 Animación cargada: ${name}`
            );
        }


        // ----------------------------------------------------
        // ANIMACIÓN INICIAL
        // ----------------------------------------------------

        playAction('idle');

    },

    undefined,

    (error) => {

        console.error(
            '❌ Error cargando personaje:',
            error
        );

    }
);


// ============================================================
// CAMBIAR ANIMACIÓN
// ============================================================

function playAction(name) {

    const next = actions[name];

    if (
        !next ||
        next === currentAction
    ) {
        return;
    }


    // Desvanecer animación anterior.
    if (currentAction) {
        currentAction.fadeOut(0.2);
    }


    // Activar nueva animación.
    next
        .reset()
        .fadeIn(0.2)
        .play();


    currentAction = next;
}


// ============================================================
// PASO 7 - MOVIMIENTO DEL PERSONAJE
// ============================================================

const desired = new THREE.Vector3();
const forward = new THREE.Vector3();
const side = new THREE.Vector3();

function updateCharacter(delta) {
    if (!character) return;

    camera.getWorldDirection(forward);

    forward.y = 0;
    forward.normalize();

    side
        .crossVectors(
            forward,
            camera.up
        )
        .normalize();

    desired.set(
        0,
        -4.5 * delta,
        0
    );

    const running =
        keyStates.ShiftLeft ||
        keyStates.ShiftRight;

    const speed =
        running ? 5.5 : 3.0;

    const move = new THREE.Vector3();

    if (keyStates.KeyW) {
        move.add(forward);
    }

    if (keyStates.KeyS) {
        move.sub(forward);
    }

    if (keyStates.KeyD) {
        move.add(side);
    }

    if (keyStates.KeyA) {
        move.sub(side);
    }

    if (move.lengthSq() > 0) {
        move.normalize();

        desired.addScaledVector(
            move,
            speed * delta
        );

        character.rotation.y =
            Math.atan2(
                move.x,
                move.z
            );

        playAction(
            running
                ? 'run'
                : 'walk'
        );
    } else {
        playAction('idle');
    }

    characterController.computeColliderMovement(
        characterCollider,
        desired
    );

    const corrected =
        characterController.computedMovement();

    const p =
        characterBody.translation();

    characterBody.setNextKinematicTranslation({
        x: p.x + corrected.x,
        y: p.y + corrected.y,
        z: p.z + corrected.z
    });
}


// ============================================================
// PASO 8 - SINCRONIZAR PERSONAJE Y CÁMARA
// ============================================================

function syncCharacter() {
    if (!character) return;

    const p =
        characterBody.translation();

    character.position.set(
        p.x,
        p.y - 0.35,
        p.z
    );
    controls.target.set(
        p.x,
        p.y + 0.7,
        p.z
    );

    controls.update();
}
const dynamicObjects = [];

function createBox(x, y, z, sx = 1, sy = 1, sz = 1, mass = 3) {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        new THREE.MeshStandardMaterial({ color: 0x9aa7b8, roughness: 0.7 })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const body = physicsWorld.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)
    );
    const collider = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
        .setMass(mass)
        .setFriction(0.7)
        .setRestitution(0.1);
    physicsWorld.createCollider(collider, body);
    dynamicObjects.push({ mesh, body });
}

// Pirámide de cajas.
for (let level = 0; level < 3; level++) {
    for (let i = 0; i < 3 - level; i++) {
        createBox(3 + i * 1.1 + level * 0.55, 0.55 + level, -4, 1, 1, 1, 4);
    }
}
let canThrow = true;

document.addEventListener('keydown', (event) => {
    if (event.code === 'KeyF' && !event.repeat && canThrow) throwObject();
});

function throwObject() {
    if (!character) return;
    canThrow = false;
    playAction('throw');

    const p = characterBody.translation();
    const dir = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(character.quaternion)
        .normalize();

    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x063b49 })
    );
    scene.add(mesh);

    const start = new THREE.Vector3(p.x, p.y + 0.6, p.z).addScaledVector(dir, 0.9);
    const body = physicsWorld.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(start.x, start.y, start.z)
    );
    physicsWorld.createCollider(RAPIER.ColliderDesc.ball(0.18).setRestitution(0.25), body);
    body.setLinvel({ x: dir.x * 13, y: 2.2, z: dir.z * 13 }, true);

    dynamicObjects.push({ mesh, body });
    setTimeout(() => { canThrow = true; }, 550);
}

function syncDynamicObjects() {
    for (const item of dynamicObjects) {
        const p = item.body.translation();
        const q = item.body.rotation();
        item.mesh.position.set(p.x, p.y, p.z);
        item.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
}

function animate() {
    timer.update();
    const delta = Math.min(0.05, timer.getDelta());

    updateCharacter(delta);
    physicsWorld.timestep = delta;
    physicsWorld.step();

    syncCharacter();
    syncDynamicObjects();
    if (mixer) mixer.update(delta);

    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});