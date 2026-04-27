# Timeline horizontal con cards superiores, inferiores y flotantes

```text

       -----------------------------------------------------------------------------------------------------------
        Génesis - Capítulo 1 / La creación aproximado 6000 a. C.  ----DESPLAZABLE----->
       -----------------------------------------------------------------------------------------------------------

      .---------------------------.         .---------------------------.         .---------------------------.
      |                           |         |                           |         |                           |
      | Versiculo 1               |         | Versiculo 2               |         | ...                       |
      | En el principio ...  RV60 |         | Y la tierra estab... RV60 |         | ...                       |
      | βιβλος γενεσεως ... GF35  |         | αβρααμ εγεννησεν... GF35  |         | ...                       |
      '-------------.-------------'         '-------------.-------------'         '-------------.-------------'
                    |                                     |                                     |
                    |                                     |                                     |
====================o=====================================o=====================================o====================>

```
Tengo un timeline de la biblia desde genesis hasta apocalipsis, necesito que resuelvas el llamado a api cuando el zoom está contraido y no caben todos los versiculos de todos los capitulos de la biblia. Por eso estoy ideando que hagas lo siguiente:

Necesito que me ayudes a segregar en eventos para renderizar en pantalla dependiendo de la prioridad.

zoom maxima contraccion:

```text
       -----------------------------------------------------------------------------------------------------------
        Génesis                                                                                       + 2033 d. C.
       -----------------------------------------------------------------------------------------------------------

   .----------..---------.   .----------.  .----------. .----------..----------.                       .----------.
   | Creacion || Diluvio |   | José/Egi |  |   Exodo  | |  La ley  ||  Jueces  |   ...        ...      |  Milenio |
   '----.-----''----.----'   '-----.----'  '-----.----' '-----.----''-----.----'                       '----.-----'
        |           |              |             |            |           |         |          |            |
========o===========o==============o=============o============o=========0=o=========o==========o============o=>
```

## Orden canónico de capítulos

**El orden de los libros y capítulos es el definido en `resources/cronologia/Lectura_Expandida.md`**, no el orden canónico del canon bíblico. Ejemplos importantes:

- Génesis 1–11, luego **Job 1–42**, luego Génesis 12 en adelante.
- Números 15, luego **Salmo 90**, luego Números 16.

Este orden cronológico intercalado es la fuente de verdad para:
- `timeline_chapter_entries.sequence` en la base de datos.
- `startSequence` / `endSequence` de cada evento en el seed JSON.
- Cualquier cálculo de posición en el timeline.

## Jerarquía de eventos

Los eventos se organizan en tres niveles de detalle más el nivel de versículos:

| Nivel | Nombre en zoom_levels | Descripción |
|---|---|---|
| Era | Panorama (L0) | Grandes divisiones históricas de la Biblia completa |
| Evento | Eras / Narrativas (L1–L2) | Episodios o narrativas dentro de una era |
| Subevento | Escenas (L3) | Escenas específicas dentro de un episodio |
| Versículo | Versículos (L4) | Versículos individuales en zoom máximo |

### Ejemplo de referencia (CSV ilustrativo — no normativo)

El siguiente CSV muestra cómo estructurar parte de Génesis 1–4. Es solo un ejemplo de la forma; **puede contener errores y no debe tomarse como definición exacta**. La prioridad del CSV corresponde al `zoomLevel` del seed:

- Prioridad 1 → zoomLevel 0 (visible en Panorama)
- Prioridad 2 → zoomLevel 1 (visible en Eras)
- Prioridad 3 → zoomLevel 2 (visible en Narrativas)
- Sin prioridad en un subevento → hereda el nivel de su padre + 1

```csv
Era,Evento,Subevento,Prioridad,Libro,Capitulo,Versiculo,Texto
Creacion,,,1,Génesis,1,1,En el principio creó Dios los cielos y la tierra.
,El caos,,,Génesis,1,2,"Y la tierra estaba desordenada y vacía, y las tinieblas estaban sobre la faz del abismo, y el Espíritu de Dios se movía sobre la faz de las aguas."
,Día 1 - La luz,,,Génesis,1,3,Y dijo Dios: Sea la luz; y fue la luz.
,,Separación de las tinieblas,,Génesis,1,4,Y vio Dios que la luz era buena; y separó Dios la luz de las tinieblas.
,,Día y la noche,,Génesis,1,5,"Y llamó Dios a la luz Día, y a las tinieblas llamó Noche. Y fue la tarde y la mañana un día."
,Día 2 - La atmosfera,,,Génesis,1,6,"Luego dijo Dios: Haya expansión en medio de las aguas, y separe las aguas de las aguas."
,,Las nubes y las aguas,,Génesis,1,7,"E hizo Dios la expansión, y separó las aguas que estaban debajo de la expansión, de las aguas que estaban sobre la expansión. Y fue así. "
,,El primer cielo,,Génesis,1,8,Y llamó Dios a la expansión Cielos. Y fue la tarde y la mañana el día segundo.
,Día 3 - Orden bajo el firmamento,,,Génesis,1,9,"Dijo también Dios: Júntense las aguas que están debajo de los cielos en un lugar, y descúbrase lo seco. Y fue así."
,,La tierra y el mar,,Génesis,1,10,"Y llamó Dios a lo seco Tierra, y a la reunión de las aguas llamó Mares. Y vio Dios que era bueno."
,,La hierba y los arboles,,Génesis,1,11,"Después dijo Dios: Produzca la tierra hierba verde, hierba que dé semilla; árbol de fruto que dé fruto según su género, que su semilla esté en él, sobre la tierra. Y fue así."
,,,,Génesis,1,12,"Produjo, pues, la tierra hierba verde, hierba que da semilla según su naturaleza, y árbol que da fruto, cuya semilla está en él, según su género. Y vio Dios que era bueno."
,,,,Génesis,1,13,Y fue la tarde y la mañana el día tercero.
,Día 4 - Las lumbreras,,,Génesis,1,14,"Dijo luego Dios: Haya lumbreras en la expansión de los cielos para separar el día de la noche; y sirvan de señales para las estaciones, para días y años,"
,,Sol y la luna,,Génesis,1,15,y sean por lumbreras en la expansión de los cielos para alumbrar sobre la tierra. Y fue así.
,,,,Génesis,1,16,"E hizo Dios las dos grandes lumbreras; la lumbrera mayor para que señorease en el día, y la lumbrera menor para que señorease en la noche; hizo también las estrellas."
,,,,Génesis,1,17,"Y las puso Dios en la expansión de los cielos para alumbrar sobre la tierra,"
,,,,Génesis,1,18,"y para señorear en el día y en la noche, y para separar la luz de las tinieblas. Y vio Dios que era bueno."
,,,,Génesis,1,19,Y fue la tarde y la mañana el día cuarto.
,Día 5 - Seres de agua,,,Génesis,1,20,"Dijo Dios: Produzcan las aguas seres vivientes, y aves que vuelen sobre la tierra, en la abierta expansión de los cielos."
,,"Monstruos marinos, peces y aves",,Génesis,1,21,"Y creó Dios los grandes monstruos marinos, y todo ser viviente que se mueve, que las aguas produjeron según su género, y toda ave alada según su especie. Y vio Dios que era bueno."
,,,,Génesis,1,22,"Y Dios los bendijo, diciendo: Fructificad y multiplicaos, y llenad las aguas en los mares, y multiplíquense las aves en la tierra."
,,,,Génesis,1,23,Y fue la tarde y la mañana el día quinto.
,Día 6 - Seres de tierra,,,Génesis,1,24,"Luego dijo Dios: Produzca la tierra seres vivientes según su género, bestias y serpientes y animales de la tierra según su especie. Y fue así."
,,"Bestias, serpientes y otros animales",,Génesis,1,25,"E hizo Dios animales de la tierra según su género, y ganado según su género, y todo animal que se arrastra sobre la tierra según su especie. Y vio Dios que era bueno."
,,El hombre,,Génesis,1,26,"Entonces dijo Dios: Hagamos al hombre a nuestra imagen, conforme a nuestra semejanza; y señoree en los peces del mar, en las aves de los cielos, en las bestias, en toda la tierra, y en todo animal que se arrastra sobre la tierra."
,,,,Génesis,1,27,"Y creó Dios al hombre a su imagen, a imagen de Dios lo creó; varón y hembra los creó."
,,,,Génesis,1,28,"Y los bendijo Dios, y les dijo: Fructificad y multiplicaos; llenad la tierra, y sojuzgadla, y señoread en los peces del mar, en las aves de los cielos, y en todas las bestias que se mueven sobre la tierra."
,,,,Génesis,1,29,"Y dijo Dios: He aquí que os he dado toda planta que da semilla, que está sobre toda la tierra, y todo árbol en que hay fruto y que da semilla; os serán para comer."
,,,,Génesis,1,30,"Y a toda bestia de la tierra, y a todas las aves de los cielos, y a todo lo que se arrastra sobre la tierra, en que hay vida, toda planta verde les será para comer. Y fue así."
,,,,Génesis,1,31,"Y vio Dios todo lo que había hecho, y he aquí que era bueno en gran manera. Y fue la tarde y la mañana el día sexto."
Fin de la creación,,,3,Génesis,2,1,"Fueron, pues, acabados los cielos y la tierra, y todo el ejército de ellos."
,Día 7,,,Génesis,2,2,Y acabó Dios en el día séptimo la obra que hizo; y reposó el día séptimo de toda la obra que hizo.
,,Día santificado,,Génesis,2,3,"Y bendijo Dios al día séptimo, y lo santificó, porque en él reposó de toda la obra que había hecho en la creación."
La formación,,,2,Génesis,2,4,"Estos son los orígenes de los cielos y de la tierra cuando fueron creados, el día que Jehová Dios hizo la tierra y los cielos,"
,,,,Génesis,2,5,"y toda planta del campo antes que fuese en la tierra, y toda hierba del campo antes que naciese; porque Jehová Dios aún no había hecho llover sobre la tierra, ni había hombre para que labrase la tierra,"
,,,,Génesis,2,6,"sino que subía de la tierra un vapor, el cual regaba toda la faz de la tierra."
,La formación del varon,,,Génesis,2,7,"Entonces Jehová Dios formó al hombre del polvo de la tierra, y sopló en su nariz aliento de vida, y fue el hombre un ser viviente."
,El huerto,,,Génesis,2,8,"Y Jehová Dios plantó un huerto en Edén, al oriente; y puso allí al hombre que había formado."
,,,,Génesis,2,9,"Y Jehová Dios hizo nacer de la tierra todo árbol delicioso a la vista, y bueno para comer; también el árbol de vida en medio del huerto, y el árbol de la ciencia del bien y del mal."
,,,,Génesis,2,10,"Y salía de Edén un río para regar el huerto, y de allí se repartía en cuatro brazos."
,,,,Génesis,2,11,"El nombre del uno era Pisón; este es el que rodea toda la tierra de Havila, donde hay oro;"
,,,,Génesis,2,12,y el oro de aquella tierra es bueno; hay allí también bedelio y ónice.
,,,,Génesis,2,13,El nombre del segundo río es Gihón; este es el que rodea toda la tierra de Cus.
,,,,Génesis,2,14,Y el nombre del tercer río es Hidekel; este es el que va al oriente de Asiria. Y el cuarto río es el Éufrates.
,,,,Génesis,2,15,"Tomó, pues, Jehová Dios al hombre, y lo puso en el huerto de Edén, para que lo labrara y lo guardase."
,,,,Génesis,2,16,"Y mandó Jehová Dios al hombre, diciendo: De todo árbol del huerto podrás comer;"
,,,,Génesis,2,17,"mas del árbol de la ciencia del bien y del mal no comerás; porque el día que de él comieres, ciertamente morirás."
,En busca de la ayuda idonea,,,Génesis,2,18,Y dijo Jehová Dios: No es bueno que el hombre esté solo; le haré ayuda idónea para él.
,,Las bestias,,Génesis,2,19,"Jehová Dios formó, pues, de la tierra toda bestia del campo, y toda ave de los cielos, y las trajo a Adán para que viese cómo las había de llamar; y todo lo que Adán llamó a los animales vivientes, ese es su nombre."
,,,,Génesis,2,20,Y puso Adán nombre a toda bestia y ave de los cielos y a todo ganado del campo; mas para Adán no se halló ayuda idónea para él.
,La formación de la varona,,,Génesis,2,21,"Entonces Jehová Dios hizo caer sueño profundo sobre Adán, y mientras este dormía, tomó una de sus costillas, y cerró la carne en su lugar."
,,,,Génesis,2,22,"Y de la costilla que Jehová Dios tomó del hombre, hizo una mujer, y la trajo al hombre."
,,,,Génesis,2,23,"Dijo entonces Adán: Esto es ahora hueso de mis huesos y carne de mi carne; esta será llamada Varona, porque del varón fue tomada."
,,,,Génesis,2,24,"Por tanto, dejará el hombre a su padre y a su madre, y se unirá a su mujer, y serán una sola carne."
,,,,Génesis,2,25,"Y estaban ambos desnudos, Adán y su mujer, y no se avergonzaban."
La caida del hombre,,,1,Génesis,3,1,"Pero la serpiente era astuta, más que todos los animales del campo que Jehová Dios había hecho; la cual dijo a la mujer: ¿Conque Dios os ha dicho: No comáis de todo árbol del huerto?"
,,,,Génesis,3,2,Y la mujer respondió a la serpiente: Del fruto de los árboles del huerto podemos comer;
,,,,Génesis,3,3,"pero del fruto del árbol que está en medio del huerto dijo Dios: No comeréis de él, ni le tocaréis, para que no muráis."
,,,,Génesis,3,4,Entonces la serpiente dijo a la mujer: No moriréis;
,,,,Génesis,3,5,"sino que sabe Dios que el día que comáis de él, serán abiertos vuestros ojos, y seréis como Dios, sabiendo el bien y el mal."
,La codicia por la sabiduria,,,Génesis,3,6,"Y vio la mujer que el árbol era bueno para comer, y que era agradable a los ojos, y árbol codiciable para alcanzar la sabiduría; y tomó de su fruto, y comió; y dio también a su marido, el cual comió así como ella."
,,,,Génesis,3,7,"Entonces fueron abiertos los ojos de ambos, y conocieron que estaban desnudos; entonces cosieron hojas de higuera, y se hicieron delantales."
,,,,Génesis,3,8,"Y oyeron la voz de Jehová Dios que se paseaba en el huerto, al aire del día; y el hombre y su mujer se escondieron de la presencia de Jehová Dios entre los árboles del huerto."
,,,,Génesis,3,9,"Mas Jehová Dios llamó al hombre, y le dijo: ¿Dónde estás tú?"
,,,,Génesis,3,10,"Y él respondió: Oí tu voz en el huerto, y tuve miedo, porque estaba desnudo; y me escondí."
,,,,Génesis,3,11,Y Dios le dijo: ¿Quién te enseñó que estabas desnudo? ¿Has comido del árbol del que yo te mandé no comieses?
,,,,Génesis,3,12,"Y el hombre respondió: La mujer que me diste por compañera me dio del árbol, y yo comí."
,,,,Génesis,3,13,"Entonces Jehová Dios dijo a la mujer: ¿Qué es lo que has hecho? Y dijo la mujer: La serpiente me engañó, y comí."
,,,,Génesis,3,14,"Y Jehová Dios dijo a la serpiente: Por cuanto esto hiciste, maldita serás entre todas las bestias y entre todos los animales del campo; sobre tu pecho andarás, y polvo comerás todos los días de tu vida."
,La profesia y las simientes,,,Génesis,3,15,"Y pondré enemistad entre ti y la mujer, y entre tu simiente y la simiente suya; esta te herirá en la cabeza, y tú le herirás en el calcañar. "
,,,,Génesis,3,16,"A la mujer dijo: Multiplicaré en gran manera los dolores en tus preñeces; con dolor darás a luz los hijos; y tu deseo será para tu marido, y él se enseñoreará de ti."
,,,,Génesis,3,17,"Y al hombre dijo: Por cuanto obedeciste a la voz de tu mujer, y comiste del árbol de que te mandé diciendo: No comerás de él; maldita será la tierra por tu causa; con dolor comerás de ella todos los días de tu vida."
,,,,Génesis,3,18,"Espinos y cardos te producirá, y comerás plantas del campo."
,,,,Génesis,3,19,"Con el sudor de tu rostro comerás el pan hasta que vuelvas a la tierra, porque de ella fuiste tomado; pues polvo eres, y al polvo volverás."
,,,,Génesis,3,20,"Y llamó Adán el nombre de su mujer, Eva, por cuanto ella era madre de todos los vivientes."
,,,,Génesis,3,21,"Y Jehová Dios hizo al hombre y a su mujer túnicas de pieles, y los vistió."
,,,,Génesis,3,22,"Y dijo Jehová Dios: He aquí el hombre es como uno de nosotros, sabiendo el bien y el mal; ahora, pues, que no alargue su mano, y tome también del árbol de la vida, y coma, y viva para siempre."
,,,,Génesis,3,23,"Y lo sacó Jehová del huerto de Edén, para que labrase la tierra de que fue tomado."
,La expulsión,,,Génesis,3,24,"Echó, pues, fuera al hombre, y puso al oriente del huerto de Edén querubines, y una espada encendida que se revolvía por todos lados, para guardar el camino del árbol de la vida."
Caín y Abel,,,2,Génesis,4,1,"Conoció Adán a su mujer Eva, la cual concibió y dio a luz a Caín, y dijo: Por voluntad de Jehová he adquirido varón."
```

> **Nota:** Este CSV es solo un ejemplo ilustrativo para Génesis 1–4. Puede contener errores en nombres, agrupaciones o prioridades. **No es la fuente de verdad.** Para implementar el seed completo, seguir el orden de `Lectura_Expandida.md` y usar criterio teológico/narrativo para determinar los niveles de cada era/evento/subevento.

## Reglas de prioridad (zoomLevel)

La era/evento está marcado por prioridad para que cuando el zoom esté más alejado posible solo muestre esas eras en el timeline. Los niveles se definen en `timeline_zoom_levels` del seed:

- **zoomLevel 0** (Panorama): Las grandes eras bíblicas — visibles en el zoom mínimo. Deben cubrir toda la Biblia de Génesis a Apocalipsis con ~14 eventos raíz.
- **zoomLevel 1** (Eras): Subdivisiones de cada era raíz. Visibles al acercarse al foco.
- **zoomLevel 2** (Narrativas): Episodios o escenas dentro de cada subdivisión.
- **zoomLevel 3** (Escenas): Micro-escenas o versos clave.
- **zoomLevel 4** (Versículos): Nivel máximo — versículos individuales desde la tabla `bible_verses`.

El criterio principal para asignar un zoomLevel es: ¿cuándo debería el usuario ver este evento naturalmente al acercarse? Una era raíz (zoomLevel 0) debe ser lo suficientemente grande como para ser distinguible en la vista panorámica de toda la Biblia.

## Foco por proximidad del puntero

El acercamiento debe tener siempre un foco, determinado por la cercanía del puntero a las eras, eventos o subeventos visibles en pantalla. Al hacer zoom:

- El servidor recibe el `focusSequence` correspondiente a la posición del puntero (no al centro de la pantalla).
- A mayor acercamiento, más eventos del nivel inmediatamente inferior aparecen alrededor del foco.
- Al desplazar horizontalmente con trackpad/rueda, el foco sigue la posición X del puntero.

## Comportamiento al hacer clic

- **Click en card de era/evento/subevento**: el canvas hace zoom al siguiente nivel mostrando los hijos del evento clicado. Simultáneamente se abre el popup de detalle.
- **Botón "Leer versículos" en el popup**: cierra el popup y hace zoom al nivel máximo (versículos) centrado en el evento.
- **Click en float card contextual**: abre popup modal con título completo y cuerpo extendido del card.

## Tareas

- [x] El acercamiento usa la posición del puntero como foco (no centro de pantalla)
- [x] Click en card de evento hace zoom al siguiente nivel + abre popup de detalle
- [x] Botón "Leer versículos" en popup de evento
- [x] Popup modal para float cards contextuales
- [x] Subeventos (L2) agregados a los días de Creación 1–7 (Génesis 1:3–2:3)
- [x] Subeventos (L3) agregados a Edén — formación, mandato, compañerismo, unión (Génesis 2:4–25)
- [x] Subeventos (L3) agregados a la Caída — tentación y acto de desobediencia (Génesis 3:1–7)
- [x] Bundle SQL regenerado (314 eventos: 14 L0 + 67 L1 + 199 L2 + 34 L3)
- [x] Sequences verificados contra `Lectura_Expandida.md`: Job (300–1369) después de Génesis 11:32 (299); Salmos 90 (5266–5282) entre Números 15:41 (5265) y Números 16:1 (5283) ✅
- [x] Subeventos (L3) agregados a 13 eventos clave del AT y NT — 41 nodos nuevos, 75 L3 en total:
  - Diluvio: entrada al arca, aguas dominan, retroceso, altar de Noé, pacto del arco iris, viña de Noé
  - Abraham: vocación, Egipto, separación de Lot, Melquisedec, pacto entre piezas, Agar/Ismael, circuncisión
  - Éxodo: décima plaga, institución Pascua, noche de muerte, salida; cruce mar Rojo
  - Sinaí: teofanía, Diez Mandamientos, libro del pacto, ratificación con sangre
  - NT: anunciación (Zacarías / María / nacimiento Juan); nacimiento en Belén / Simeón / templo a los 12
  - Galilea: llamado discípulos, Caná, Nicodemo/Samaritana, milagros de autoridad
  - Pasión: 4 relatos de crucifixión (Mt/Mc/Lc/Jn); 4 relatos de resurrección (Mt/Mc/Lc/Jn)
- [x] Bundle SQL regenerado (355 eventos: 14 L0 + 67 L1 + 199 L2 + 75 L3); BD recargada ✅
- [x] Enriquecimiento masivo L3 — 4 batches cubriendo TODO el AT y NT (Génesis–Apocalipsis):
  - Batch 1 (58 nodos): Patriarcas, Moisés-Wandering, Jueces, Samuel/Saúl/David, construcción del Templo
  - Batch 2 (60 nodos): Salomón, División, Elías/Eliseo, Asiria, Babilonia, Job diálogos, Salmos/Proverbios/Eclesiastés
  - Batch 3 (60 nodos): Isaías, Jeremías, Ezequiel, Profetas Menores, Restauración, Intertestamentario, NT Infancia-Ministerio-Epístolas cortas
  - Batch 4 (157 nodos): Profetas Menores restantes, exilio/retorno, Macabeos, Ministerio de Jesús completo, Hechos, Epístolas paulinas, Epístolas generales, Apocalipsis
  - ID duplicado `new-creation` corregido → `new-creation-scene` (L3 bajo revelation-new-heavens-and-city)
- [x] Bundle SQL regenerado (690 eventos: 14 L0 + 67 L1 + 199 L2 + 410 L3); BD recargada ✅
- [x] 9/9 pruebas API superadas tras recarga ✅
- [x] El nivel máximo de zoom muestra todos los versículos secuencialmente *(ya funciona en la UI)*
- [x] Las cards muestran Era, evento, subevento según nivel de zoom *(ya funciona en la UI)*
- L2 sin hijos L3 (intencionado — demasiado pequeños o genealogías puras): días de Creación 1–7 individuales (13 nodos), early-humanity-cains-line, psalm-of-moses-and-refuge
