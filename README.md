
# Instituto Tecnológico de Pachuca

## Ingeniería en tecnologías de la Información y Comunicaciones

### Desarrollo de Soluciones en Ambientes virtuales

Profesor: **Víctor Manuel Pinedo Fernández**

Autor: **Alicia Yamileth Mariano Reséndiz**

Fecha: **22/09/2026**

# 1.5 Personalización de escenarios

## Descripción

En esta actividad se desarrolló un escenario 3D interactivo utilizando **Three.js** para la parte visual y **Rapier** para implementar las físicas y colisiones.

El proyecto incluye un personaje animado que puede desplazarse por el escenario en tercera persona, interactuar con objetos físicos y lanzar proyectiles.

Además, se realizó una segunda parte de la práctica en la que se sustituyó el escenario original por uno diferente, manteniendo el mismo sistema de movimiento, animaciones y físicas del personaje. Esto permitió comprobar que la arquitectura desarrollada puede reutilizarse sin tener que programar nuevamente todo el proyecto.

## Tecnologías utilizadas

- HTML
- CSS
- JavaScript
- Three.js
- Rapier 3D
- GLTFLoader
- OrbitControls
- Modelos GLTF/GLB
- Animaciones de Mixamo

## Funcionalidades

El proyecto cuenta con las siguientes características:

- Carga de escenarios 3D en formato GLTF.
- Personaje 3D en formato GLB.
- Sistema de físicas utilizando Rapier.
- Colisiones entre el personaje y el escenario.
- Movimiento del personaje con teclado.
- Cámara en tercera persona.
- Animaciones de:
  - Idle
  - Walk
  - Run
  - Throw
- Eliminación del desplazamiento interno de las animaciones para evitar retrocesos durante la caminata.
- Objetos dinámicos con físicas.
- Cajas que pueden ser empujadas por el personaje.
- Lanzamiento de proyectiles.
- Interacción entre proyectiles y cajas.
- Adaptación del personaje y objetos a diferentes escalas de escenario.

## Controles

| Tecla | Acción                |
| ----- | ---------------------- |
| W     | Avanzar                |
| S     | Retroceder             |
| A     | Moverse a la izquierda |
| D     | Moverse a la derecha   |
| Shift | Correr                 |
| F     | Lanzar proyectil       |
| Mouse | Mover la cámara       |
