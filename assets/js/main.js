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
// ============================================================
// CÁMARA DE TERCERA PERSONA
// ============================================================

const cameraFollowPosition = new THREE.Vector3();

const lastCharacterPosition = new THREE.Vector3();

let cameraFollowInitialized = false;

controls.enableDamping = true;
controls.enablePan = false;

// Cámara más cercana al personaje.
controls.minDistance = 1.2;
controls.maxDistance = 3.5;

// Evita que la cámara pueda voltearse completamente
// por debajo del escenario.
controls.maxPolarAngle = Math.PI * 0.48;

const physicsWorld = new RAPIER.World({
    x: 0,
    y: -9.81,
    z: 0
});

const loader = new GLTFLoader();

const timer = new THREE.Timer();

let worldReady = false;

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
    './assets/models/street/scene.gltf',
    (gltf) => {
        const street = gltf.scene;

        // =====================================================
        // AJUSTAR ESCALA DEL NUEVO ESCENARIO
        // =====================================================

        street.scale.setScalar(0.03);

        // Actualizamos las matrices antes de medirlo.
        street.updateMatrixWorld(true);


        // =====================================================
        // CENTRAR EL ESCENARIO AUTOMÁTICAMENTE
        // =====================================================

        const box = new THREE.Box3().setFromObject(street);
        const center = new THREE.Vector3();

        box.getCenter(center);

        // Centramos X y Z.
        // Dejamos Y respetando la altura original del suelo.
        street.position.x -= center.x;
        street.position.z -= center.z;

        street.updateMatrixWorld(true);


        // =====================================================
        // CREAR COLLIDERS
        // =====================================================

        street.traverse((child) => {
            if (!child.isMesh) return;

            child.castShadow = true;
            child.receiveShadow = true;

            createStaticTrimesh(child);
        });


        scene.add(street);

        // Ahora que existe el suelo físico,
        // creamos los objetos dinámicos.
        createBoxPyramid();

        // Activamos las físicas.
        worldReady = true;

        console.log('✅ Nuevo escenario cargado');
        console.log('✅ Objetos dinámicos creados');
        console.log('✅ Físicas activadas');
    },

    undefined,

    (error) => {
        console.error(
            '❌ Error cargando escenario:',
            error
        );
    }
);


// ============================================================
// PASO 5 - CUERPO FÍSICO DEL PERSONAJE
// ============================================================

const characterBody = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc
        .kinematicPositionBased()
        .setTranslation(-9.5, 0.86, -3.5)
);

const characterCollider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.capsule(
        0.14,
        0.20
    ),
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

// Permite empujar cuerpos dinámicos.
characterController.setApplyImpulsesToDynamicBodies(
    true
);

// Masa virtual usada para calcular
// la fuerza con la que el personaje empuja.
characterController.setCharacterMass(12);
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

function makeClipInPlace(originalClip) {
    const clip = originalClip.clone();

    for (const track of clip.tracks) {

        const isHipsPosition =
            (
                track.name.includes('mixamorig:Hips') ||
                track.name.includes('Hips')
            ) &&
            (
                track.name.endsWith('.position') ||
                track.name.endsWith('.translation')
            );

        if (!isHipsPosition) {
            continue;
        }

        const values = track.values;

        if (values.length < 3) {
            continue;
        }

        // Primer frame de la animación.
        const startX = values[0];
        const startY = values[1];
        const startZ = values[2];

        for (let i = 0; i < values.length; i += 3) {

            // Eliminar desplazamiento lateral.
            values[i] = startX;

            // Mantener el movimiento vertical natural
            // de la caminata.
            values[i + 1] =
                startY +
                (values[i + 1] - startY);

            // Eliminar completamente el avance/retroceso
            // incorporado en la animación.
            values[i + 2] = startZ;
        }

        console.log(
            `✅ Root Motion eliminado de: ${clip.name}`
        );
    }

    return clip;
}


loader.load(
    './assets/models/character/character.glb',

    (gltf) => {

        character = gltf.scene;

        // Escala que ya elegiste.
        character.scale.setScalar(0.4);

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
                    originalClip
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

    const p = characterBody.translation();


    // ========================================================
    // SINCRONIZAR MODELO CON RAPIER
    // ========================================================

    character.position.set(
        p.x,
        p.y - 0.42,
        p.z
    );


    // ========================================================
    // PUNTO QUE MIRA LA CÁMARA
    // ========================================================

    const cameraTarget = new THREE.Vector3(
        p.x,
        p.y + 0.15,
        p.z
    );


    // ========================================================
    // POSICIÓN INICIAL DE LA CÁMARA
    // ========================================================

    if (!cameraFollowInitialized) {

        // La colocamos detrás y ligeramente arriba.
        camera.position.set(
            p.x,
            p.y + 0.75,
            p.z - 2.2
        );

        controls.target.copy(
            cameraTarget
        );

        lastCharacterPosition.set(
            p.x,
            p.y,
            p.z
        );

        cameraFollowInitialized = true;

        controls.update();

        return;
    }


    // ========================================================
    // SEGUIR EL MOVIMIENTO DEL PERSONAJE
    // ========================================================

    cameraFollowPosition.set(
        p.x,
        p.y,
        p.z
    );

    const movement =
        cameraFollowPosition
            .clone()
            .sub(lastCharacterPosition);


    // Movemos la cámara la misma distancia
    // que avanzó el personaje.
    camera.position.add(
        movement
    );


    // La cámara siempre mira al personaje.
    controls.target.copy(
        cameraTarget
    );


    // Guardar posición para el siguiente frame.
    lastCharacterPosition.copy(
        cameraFollowPosition
    );


    controls.update();
}
const dynamicObjects = [];

function createBox(x, y, z, sx = 1, sy = 1, sz = 1, mass = 3) {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        new THREE.MeshStandardMaterial({
    color: 0xBB5A22,
    roughness: 0.8
})
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
function createBoxPyramid() {
    const boxSize = 0.65;
    const separation = 0.72;

    for (let level = 0; level < 3; level++) {

        for (let i = 0; i < 3 - level; i++) {

            createBox(
                -7
                    + i * separation
                    + level * (separation / 2),

                0.9
                    + level * separation,

                -3.5,

                boxSize,
                boxSize,
                boxSize,

                2
            );
        }
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


    // ========================================================
    // PROYECTIL VISUAL
    // ========================================================

    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(
            0.10,
            16,
            16
        ),
        new THREE.MeshStandardMaterial({
            color: 0x8B5A2B,
            roughness: 0.8
        })
    );

    mesh.castShadow = true;

    scene.add(mesh);


    // ========================================================
    // POSICIÓN DE SALIDA
    // ========================================================

    const start = new THREE.Vector3(
        p.x,
        p.y + 0.22,
        p.z
    ).addScaledVector(
        dir,
        0.55
    );


    // ========================================================
    // CUERPO FÍSICO
    // ========================================================

    const body = physicsWorld.createRigidBody(
        RAPIER.RigidBodyDesc
            .dynamic()
            .setTranslation(
                start.x,
                start.y,
                start.z
            )
    );


    // ========================================================
    // COLLIDER DEL PROYECTIL
    // ========================================================

    const projectileCollider =
        RAPIER.ColliderDesc
            .ball(0.10)

            // Aunque visualmente sea pequeño,
            // tendrá suficiente masa para empujar cajas.
            .setMass(1.0)

            .setRestitution(0.25);

    physicsWorld.createCollider(
        projectileCollider,
        body
    );


    // ========================================================
    // VELOCIDAD
    // ========================================================

    body.setLinvel(
        {
            x: dir.x * 15,
            y: 1.0,
            z: dir.z * 15
        },
        true
    );


    dynamicObjects.push({
        mesh,
        body
    });


    // Pequeño tiempo entre lanzamientos.
    setTimeout(
        () => {
            canThrow = true;
        },
        550
    );
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

    const delta = Math.min(
        0.05,
        timer.getDelta()
    );

    // Las físicas solamente funcionan
    // cuando el escenario está completamente cargado.
    if (worldReady) {

        updateCharacter(delta);

        physicsWorld.timestep = delta;
        physicsWorld.step();

        syncCharacter();
        syncDynamicObjects();
    }

    if (mixer) {
        mixer.update(delta);
    }

    renderer.render(
        scene,
        camera
    );
}
renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});