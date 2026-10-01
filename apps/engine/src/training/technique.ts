/** Spanish technique for every library exercise: steps in order, then short cues. Keyed by library id. */
export const TECHNIQUE: Record<string, { instructions: string[]; tips: string[] }> = {
  // Chest
  "press-banca": {
    instructions: [
      "Túmbate en el banco con los ojos bajo la barra y los pies firmes en el suelo.",
      "Junta y baja las escápulas, y forma un arco lumbar ligero sin despegar los glúteos.",
      "Agarra la barra algo más abierto que los hombros y sácala con los brazos estirados.",
      "Baja la barra controlada hasta la parte baja del pecho, con los antebrazos verticales.",
      "Empuja hacia arriba y ligeramente hacia atrás hasta bloquear los codos.",
    ],
    tips: [
      "Junta las escápulas y mantenlas así toda la serie.",
      "Codos a unos 45°, no abiertos en cruz.",
      "Evita rebotar la barra en el pecho.",
      "Empuja el suelo con las piernas.",
    ],
  },
  "press-inclinado-barra": {
    instructions: [
      "Ajusta el banco a unos 30° y túmbate con los ojos bajo la barra.",
      "Junta las escápulas, apoya bien los pies y agarra algo más abierto que los hombros.",
      "Saca la barra y colócala sobre la parte alta del pecho con los brazos estirados.",
      "Baja controlado hasta tocar la parte alta del pecho, bajo las clavículas.",
      "Empuja en vertical hasta bloquear los codos.",
    ],
    tips: [
      "Inclinación de 30°; más alto carga más el hombro.",
      "Antebrazos verticales abajo.",
      "No despegues los glúteos del banco.",
    ],
  },
  "press-banca-mancuernas": {
    instructions: [
      "Siéntate con las mancuernas sobre los muslos y túmbate llevándolas al pecho con ayuda de las rodillas.",
      "Junta las escápulas y apoya los pies firmes en el suelo.",
      "Empuja las mancuernas hacia arriba hasta estirar los brazos sobre el pecho.",
      "Baja controlado hasta que queden a la altura del pecho, con los codos a unos 45°.",
      "Sube de nuevo juntándolas ligeramente arriba sin chocarlas.",
    ],
    tips: [
      "Codos a 45°, no abiertos.",
      "Baja hasta notar estiramiento en el pecho.",
      "Mantén las muñecas rectas sobre los codos.",
    ],
  },
  "press-inclinado-mancuernas": {
    instructions: [
      "Ajusta el banco a unos 30° y túmbate con las mancuernas apoyadas en los muslos.",
      "Llévalas a la altura de los hombros con ayuda de las rodillas y junta las escápulas.",
      "Empuja hacia arriba hasta estirar los brazos sobre la parte alta del pecho.",
      "Baja controlado hasta que las mancuernas queden junto a la parte alta del pecho.",
      "Sube de nuevo sin chocar las mancuernas arriba.",
    ],
    tips: [
      "Inclinación de 30°, no más.",
      "Codos ligeramente por debajo de los hombros.",
      "Controla la bajada, unos 2 segundos.",
    ],
  },
  "press-pecho-maquina": {
    instructions: [
      "Ajusta el asiento para que las asas queden a la altura de la mitad del pecho.",
      "Siéntate con la espalda apoyada, las escápulas juntas y los pies en el suelo.",
      "Empuja las asas hacia delante hasta casi estirar los codos.",
      "Vuelve despacio hasta notar estiramiento en el pecho sin perder la postura.",
    ],
    tips: [
      "Asas a la altura del pecho, no del cuello.",
      "No despegues la espalda del respaldo.",
      "Evita que los hombros se adelanten al empujar.",
    ],
  },
  "fondos": {
    instructions: [
      "Sujétate en las paralelas con los brazos estirados y los hombros lejos de las orejas.",
      "Inclina ligeramente el torso hacia delante para cargar más el pecho.",
      "Baja flexionando los codos hasta que los hombros queden a la altura de los codos o algo más abajo.",
      "Empuja hasta estirar los brazos sin bloquear de golpe.",
    ],
    tips: [
      "Hombros abajo, lejos de las orejas.",
      "Baja solo hasta donde el hombro esté cómodo.",
      "No balancees las piernas.",
    ],
  },
  "flexiones": {
    instructions: [
      "Apoya las manos algo más abiertas que los hombros y estira el cuerpo en línea recta.",
      "Aprieta glúteos y abdomen para que la cadera no se hunda.",
      "Baja el pecho hacia el suelo con los codos a unos 45° del cuerpo.",
      "Empuja el suelo hasta estirar los brazos manteniendo el cuerpo recto.",
    ],
    tips: [
      "Cuerpo en una línea de cabeza a talones.",
      "Codos a 45°, no abiertos en cruz.",
      "Evita hundir la cadera.",
    ],
  },
  "aperturas-mancuernas": {
    instructions: [
      "Túmbate en el banco con las mancuernas sobre el pecho y las palmas enfrentadas.",
      "Flexiona ligeramente los codos y mantén ese ángulo todo el recorrido.",
      "Abre los brazos en arco hasta notar estiramiento en el pecho.",
      "Cierra el arco llevando las mancuernas de vuelta sobre el pecho.",
    ],
    tips: [
      "Codos ligeramente flexionados y fijos.",
      "Piensa en abrazar un árbol.",
      "No bajes más allá de la línea de los hombros.",
    ],
  },
  "cruce-poleas": {
    instructions: [
      "Coloca las poleas a la altura de los hombros o algo más arriba y toma un asa en cada mano.",
      "Da un paso al frente, inclina el torso un poco y flexiona ligeramente los codos.",
      "Junta las manos delante del pecho en un arco amplio.",
      "Vuelve despacio hasta notar estiramiento en el pecho.",
    ],
    tips: [
      "Mantén el ángulo del codo fijo.",
      "Aprieta el pecho al juntar las manos.",
      "No tires con los brazos ni con el impulso del torso.",
    ],
  },
  "contractor-pecho": {
    instructions: [
      "Ajusta el asiento para que las asas queden a la altura del pecho.",
      "Siéntate con la espalda apoyada y los codos ligeramente flexionados.",
      "Junta las asas delante del pecho en un arco controlado.",
      "Vuelve despacio hasta notar estiramiento sin que los hombros se adelanten.",
    ],
    tips: [
      "Pecho alto y escápulas juntas.",
      "Pausa breve al cerrar.",
      "Evita soltar el peso en la vuelta.",
    ],
  },
  // Back
  "peso-muerto": {
    instructions: [
      "Colócate con los pies a la anchura de la cadera y la barra sobre la mitad del pie.",
      "Agárrala justo por fuera de las piernas y baja la cadera hasta que las tibias toquen la barra.",
      "Saca el pecho, tensa los dorsales y respira para bloquear el tronco.",
      "Empuja el suelo con las piernas y sube la barra pegada al cuerpo hasta quedar de pie.",
      "Baja llevando la cadera atrás primero y doblando las rodillas cuando la barra las pase.",
    ],
    tips: [
      "Barra sobre la mitad del pie.",
      "Dorsales tensos, como si apretaras naranjas.",
      "Empuja el suelo, no tires con la espalda.",
      "Evita redondear la zona lumbar.",
    ],
  },
  "remo-barra": {
    instructions: [
      "Agarra la barra algo más abierto que los hombros y ponte de pie con ella.",
      "Inclina el torso hacia delante con la espalda neutra y las rodillas ligeramente flexionadas.",
      "Tira de la barra hacia la parte baja del pecho o el abdomen, llevando los codos atrás.",
      "Baja controlado hasta estirar los brazos sin cambiar el ángulo del torso.",
    ],
    tips: [
      "Torso firme, sin dar tirones.",
      "Junta las escápulas arriba.",
      "Evita levantar el torso para subir más peso.",
    ],
  },
  "remo-mancuerna": {
    instructions: [
      "Apoya una mano y la rodilla del mismo lado en un banco, con la espalda paralela al suelo.",
      "Sujeta la mancuerna con el brazo estirado bajo el hombro.",
      "Tira de la mancuerna hacia la cadera llevando el codo atrás y pegado al cuerpo.",
      "Baja controlado hasta estirar el brazo y notar estiramiento en la espalda.",
    ],
    tips: [
      "Lleva el codo hacia la cadera.",
      "No gires el torso para subir.",
      "Espalda neutra todo el tiempo.",
    ],
  },
  "dominadas": {
    instructions: [
      "Cuélgate de la barra con agarre prono, algo más abierto que los hombros.",
      "Baja los hombros y tensa el abdomen antes de empezar.",
      "Tira llevando los codos hacia abajo hasta que la barbilla pase la barra.",
      "Baja controlado hasta estirar los brazos por completo.",
    ],
    tips: [
      "Empieza bajando los hombros.",
      "Piensa en llevar los codos a los bolsillos.",
      "Evita balancearte o dar patadas.",
    ],
  },
  "dominadas-supinas": {
    instructions: [
      "Cuélgate de la barra con las palmas hacia ti, a la anchura de los hombros.",
      "Baja los hombros y tensa el abdomen.",
      "Tira llevando los codos hacia abajo y pegados hasta que la barbilla pase la barra.",
      "Baja controlado hasta estirar los brazos.",
    ],
    tips: [
      "Rango completo: brazos estirados abajo.",
      "Pecho hacia la barra.",
      "Sin balanceo ni impulso.",
    ],
  },
  "jalon-pecho": {
    instructions: [
      "Ajusta el rodillo para fijar los muslos y agarra la barra algo más abierto que los hombros.",
      "Siéntate con el pecho alto y una ligera inclinación hacia atrás.",
      "Tira de la barra hacia la parte alta del pecho llevando los codos abajo.",
      "Sube controlado hasta estirar los brazos y dejar que los hombros se eleven un poco.",
    ],
    tips: [
      "Codos hacia abajo, no hacia atrás.",
      "No te eches muy atrás para tirar.",
      "Evita llevar la barra detrás de la nuca.",
    ],
  },
  "remo-polea-baja": {
    instructions: [
      "Siéntate con los pies en el apoyo, las rodillas algo flexionadas y agarra el asa.",
      "Ponte erguido con el pecho alto y los brazos estirados.",
      "Tira del asa hacia el abdomen llevando los codos atrás y juntando las escápulas.",
      "Vuelve despacio estirando los brazos sin balancear el torso.",
    ],
    tips: [
      "Torso quieto, sin balanceo.",
      "Junta las escápulas al final.",
      "No encojas los hombros.",
    ],
  },
  "remo-maquina": {
    instructions: [
      "Ajusta el asiento para que las asas queden a la altura de la parte baja del pecho.",
      "Apoya el pecho en el soporte y agarra las asas con los brazos estirados.",
      "Tira llevando los codos atrás hasta juntar las escápulas.",
      "Vuelve controlado hasta estirar los brazos.",
    ],
    tips: [
      "Pecho pegado al soporte.",
      "Tira con los codos, no con las manos.",
      "Pausa breve atrás.",
    ],
  },
  "pullover-polea": {
    instructions: [
      "Coloca la polea alta con una cuerda o barra y da un paso atrás.",
      "Inclina el torso hacia delante con los brazos estirados y los codos algo flexionados.",
      "Lleva la barra hacia los muslos en arco, tirando desde los dorsales.",
      "Vuelve despacio hasta que los brazos queden a la altura de la cabeza.",
    ],
    tips: [
      "Brazos casi rectos todo el recorrido.",
      "Piensa en empujar con los dorsales.",
      "No flexiones los codos para ayudarte.",
    ],
  },
  "encogimientos": {
    instructions: [
      "Ponte de pie con una mancuerna en cada mano y los brazos estirados a los lados.",
      "Mantén el pecho alto y la mirada al frente.",
      "Sube los hombros hacia las orejas lo más alto posible.",
      "Mantén un instante arriba y baja despacio.",
    ],
    tips: [
      "Sube recto, sin girar los hombros.",
      "No flexiones los codos.",
      "Pausa de un segundo arriba.",
    ],
  },
  "hiperextensiones": {
    instructions: [
      "Ajusta el banco para que el apoyo quede justo por debajo de la cadera.",
      "Cruza los brazos sobre el pecho con el cuerpo en línea recta.",
      "Baja el torso flexionando la cadera con la espalda neutra.",
      "Sube apretando glúteos hasta que el cuerpo quede de nuevo en línea recta.",
    ],
    tips: [
      "Mueve la cadera, no la zona lumbar.",
      "Evita hiperextender arriba.",
      "Controla la bajada.",
    ],
  },
  // Shoulders
  "press-militar": {
    instructions: [
      "Coloca la barra sobre la parte alta del pecho con agarre algo más abierto que los hombros.",
      "Ponte de pie con los pies a la anchura de la cadera y aprieta glúteos y abdomen.",
      "Empuja la barra en vertical apartando un poco la cabeza para dejarla pasar.",
      "Bloquea arriba con la barra sobre la mitad del pie y mete la cabeza bajo ella.",
      "Baja controlado hasta la parte alta del pecho.",
    ],
    tips: [
      "Glúteos y abdomen apretados.",
      "Antebrazos verticales en la salida.",
      "Evita arquear la espalda baja.",
    ],
  },
  "press-hombro-mancuernas": {
    instructions: [
      "Siéntate en un banco con respaldo vertical y sube las mancuernas a la altura de los hombros.",
      "Apoya la espalda y coloca los codos algo por delante del cuerpo.",
      "Empuja las mancuernas hacia arriba hasta casi estirar los brazos.",
      "Baja controlado hasta que queden a la altura de las orejas.",
    ],
    tips: [
      "Muñecas sobre los codos.",
      "Codos algo adelantados, no en cruz.",
      "No despegues la espalda del respaldo.",
    ],
  },
  "press-arnold": {
    instructions: [
      "Siéntate con las mancuernas delante de los hombros y las palmas hacia ti.",
      "Empieza a empujar hacia arriba mientras giras las palmas hacia delante.",
      "Termina con los brazos casi estirados y las palmas al frente.",
      "Baja deshaciendo el giro hasta volver a la posición inicial.",
    ],
    tips: [
      "Gira y empuja a la vez.",
      "Movimiento fluido, sin tirones.",
      "Usa menos peso que en el press normal.",
    ],
  },
  "press-hombro-maquina": {
    instructions: [
      "Ajusta el asiento para que las asas queden a la altura de los hombros.",
      "Siéntate con la espalda apoyada y agarra las asas.",
      "Empuja hacia arriba hasta casi estirar los codos.",
      "Baja controlado hasta la altura de los hombros.",
    ],
    tips: [
      "Espalda pegada al respaldo.",
      "No bloquees los codos de golpe.",
      "Controla la bajada.",
    ],
  },
  "elevaciones-laterales": {
    instructions: [
      "Ponte de pie con una mancuerna en cada mano a los lados y el torso algo inclinado.",
      "Flexiona ligeramente los codos y mantén ese ángulo.",
      "Eleva los brazos hacia los lados hasta la altura de los hombros.",
      "Baja despacio sin dejar caer las mancuernas.",
    ],
    tips: [
      "Lleva las mancuernas lejos, no arriba.",
      "Codos a la altura de las muñecas o algo más.",
      "Evita el balanceo y encoger los hombros.",
    ],
  },
  "elevaciones-laterales-polea": {
    instructions: [
      "Coloca la polea abajo y agarra el asa con la mano contraria, cruzando por delante.",
      "Ponte de lado a la polea con el codo algo flexionado.",
      "Eleva el brazo hacia el lado hasta la altura del hombro.",
      "Baja despacio manteniendo la tensión del cable.",
    ],
    tips: [
      "Tensión constante todo el recorrido.",
      "No encojas el hombro.",
      "Sin inclinar el torso para subir.",
    ],
  },
  "pajaros": {
    instructions: [
      "Inclina el torso hacia delante casi paralelo al suelo con la espalda neutra.",
      "Deja colgar las mancuernas bajo el pecho con los codos algo flexionados.",
      "Abre los brazos hacia los lados hasta la altura de los hombros.",
      "Baja despacio sin perder la postura.",
    ],
    tips: [
      "Abre hacia los lados, no hacia atrás.",
      "No juntes las escápulas en exceso.",
      "Peso ligero y controlado.",
    ],
  },
  "face-pull": {
    instructions: [
      "Coloca la polea a la altura de la cara con una cuerda y agarra los extremos.",
      "Da un paso atrás con los brazos estirados y el torso firme.",
      "Tira de la cuerda hacia la cara separando las manos y llevando los codos altos.",
      "Termina con las manos junto a las orejas y vuelve despacio.",
    ],
    tips: [
      "Codos altos, a la altura de los hombros.",
      "Separa las manos al final.",
      "Evita echar el torso atrás.",
    ],
  },
  // Biceps
  "curl-barra": {
    instructions: [
      "Ponte de pie con la barra en agarre supino a la anchura de los hombros.",
      "Pega los codos a los costados y mantén el torso quieto.",
      "Flexiona los codos subiendo la barra hasta los hombros.",
      "Baja despacio hasta estirar los brazos.",
    ],
    tips: [
      "Codos fijos a los costados.",
      "Sin balancear el torso.",
      "Estira del todo abajo.",
    ],
  },
  "curl-mancuernas": {
    instructions: [
      "Ponte de pie con una mancuerna en cada mano y las palmas hacia delante.",
      "Pega los codos a los costados.",
      "Sube las mancuernas flexionando los codos hasta los hombros.",
      "Baja despacio hasta estirar los brazos.",
    ],
    tips: [
      "Codos quietos.",
      "Aprieta el bíceps arriba.",
      "Evita el impulso con la espalda.",
    ],
  },
  "curl-martillo": {
    instructions: [
      "Ponte de pie con una mancuerna en cada mano y las palmas enfrentadas.",
      "Pega los codos a los costados.",
      "Sube las mancuernas sin girar las muñecas hasta la altura de los hombros.",
      "Baja despacio hasta estirar los brazos.",
    ],
    tips: [
      "Palmas enfrentadas todo el recorrido.",
      "Codos fijos a los costados.",
      "Sin balanceo.",
    ],
  },
  "curl-inclinado": {
    instructions: [
      "Ajusta el banco a unos 45–60° y siéntate con la espalda apoyada.",
      "Deja colgar las mancuernas con los brazos estirados y las palmas al frente.",
      "Sube las mancuernas sin adelantar los codos.",
      "Baja despacio hasta estirar los brazos por completo.",
    ],
    tips: [
      "Codos apuntando al suelo.",
      "Estiramiento completo abajo.",
      "Cabeza y espalda apoyadas.",
    ],
  },
  "curl-predicador": {
    instructions: [
      "Ajusta el asiento para que las axilas queden sobre el borde del banco predicador.",
      "Apoya la parte trasera de los brazos en el cojín y agarra la barra en supino.",
      "Sube la barra flexionando los codos sin despegar los brazos.",
      "Baja despacio hasta casi estirar los codos.",
    ],
    tips: [
      "Brazos pegados al cojín.",
      "Controla la bajada.",
      "No bloquees los codos de golpe abajo.",
    ],
  },
  "curl-polea": {
    instructions: [
      "Coloca la polea abajo con una barra y agárrala en supino.",
      "Ponte de pie cerca de la polea con los codos pegados a los costados.",
      "Sube la barra flexionando los codos hasta los hombros.",
      "Baja despacio manteniendo la tensión del cable.",
    ],
    tips: [
      "Codos fijos.",
      "Tensión constante.",
      "Sin echar el torso atrás.",
    ],
  },
  // Triceps
  "press-banca-cerrado": {
    instructions: [
      "Túmbate en el banco con los ojos bajo la barra y las escápulas juntas.",
      "Agarra la barra a la anchura de los hombros.",
      "Baja la barra hasta la parte baja del pecho con los codos pegados al cuerpo.",
      "Empuja hasta bloquear los codos.",
    ],
    tips: [
      "Agarre a la anchura de los hombros, no más estrecho.",
      "Codos cerca del cuerpo.",
      "Muñecas rectas.",
    ],
  },
  "press-frances": {
    instructions: [
      "Túmbate en el banco con la barra sobre el pecho y los brazos estirados.",
      "Inclina un poco los brazos hacia atrás, hacia la cabeza.",
      "Baja la barra flexionando solo los codos hacia la frente o detrás de la cabeza.",
      "Estira los codos para volver a la posición inicial.",
    ],
    tips: [
      "Codos apuntando al techo, sin abrirlos.",
      "Solo se mueven los antebrazos.",
      "Baja controlado.",
    ],
  },
  "extension-triceps-polea": {
    instructions: [
      "Coloca la polea alta con una cuerda o barra y agárrala.",
      "Pega los codos a los costados con el torso algo inclinado.",
      "Estira los codos empujando hacia abajo hasta bloquear.",
      "Sube despacio hasta que los antebrazos queden algo por encima de la horizontal.",
    ],
    tips: [
      "Codos fijos a los costados.",
      "Separa la cuerda abajo.",
      "No uses el torso para empujar.",
    ],
  },
  "extension-triceps-sobre-cabeza": {
    instructions: [
      "Sujeta una mancuerna con ambas manos por el disco superior.",
      "Súbela sobre la cabeza con los brazos estirados.",
      "Baja la mancuerna detrás de la cabeza flexionando solo los codos.",
      "Estira los codos para volver arriba.",
    ],
    tips: [
      "Codos apuntando al frente, sin abrirlos.",
      "Abdomen firme, sin arquear la espalda.",
      "Estiramiento completo abajo.",
    ],
  },
  "patada-triceps": {
    instructions: [
      "Apoya una mano y una rodilla en un banco con la espalda paralela al suelo.",
      "Sube el codo hasta pegarlo al costado con el brazo paralelo al suelo.",
      "Estira el codo llevando la mancuerna hacia atrás.",
      "Vuelve despacio sin mover el brazo.",
    ],
    tips: [
      "Brazo quieto, solo se mueve el antebrazo.",
      "Aprieta el tríceps al estirar.",
      "Peso ligero y controlado.",
    ],
  },
  // Forearms
  "curl-muneca": {
    instructions: [
      "Siéntate con los antebrazos apoyados sobre los muslos y las muñecas por fuera de las rodillas.",
      "Sujeta las mancuernas con las palmas hacia arriba.",
      "Deja que las muñecas bajen y que las mancuernas rueden hacia los dedos.",
      "Flexiona las muñecas subiendo las mancuernas lo más alto posible.",
    ],
    tips: [
      "Antebrazos fijos sobre los muslos.",
      "Rango completo de muñeca.",
      "Movimiento lento.",
    ],
  },
  // Quads
  "sentadilla": {
    instructions: [
      "Coloca la barra sobre los trapecios y sácala del soporte con un par de pasos atrás.",
      "Pon los pies a la anchura de los hombros con las puntas algo abiertas.",
      "Respira y bloquea el abdomen antes de bajar.",
      "Baja llevando la cadera atrás y abajo, con las rodillas en la línea de los pies.",
      "Llega al menos a la paralela si tu movilidad lo permite.",
      "Sube empujando el suelo con todo el pie y mantén el pecho alto.",
    ],
    tips: [
      "Bloquea el tronco antes de cada repetición.",
      "Rodillas en la dirección de las puntas.",
      "Peso repartido en todo el pie.",
      "Evita que las rodillas se cierren al subir.",
    ],
  },
  "sentadilla-frontal": {
    instructions: [
      "Apoya la barra sobre la parte delantera de los hombros con los codos altos.",
      "Pon los pies a la anchura de los hombros con las puntas algo abiertas.",
      "Respira y bloquea el abdomen.",
      "Baja recto con el torso erguido y las rodillas hacia delante en la línea de los pies.",
      "Sube empujando el suelo y manteniendo los codos altos.",
    ],
    tips: [
      "Codos altos todo el tiempo.",
      "Torso lo más vertical posible.",
      "No dejes caer la barra hacia delante.",
    ],
  },
  "sentadilla-goblet": {
    instructions: [
      "Sujeta la kettlebell por las asas delante del pecho, pegada al cuerpo.",
      "Pon los pies algo más abiertos que la cadera con las puntas hacia fuera.",
      "Baja entre las piernas con el pecho alto y los codos por dentro de las rodillas.",
      "Sube empujando el suelo hasta quedar de pie.",
    ],
    tips: [
      "Kettlebell pegada al pecho.",
      "Pecho alto, mirada al frente.",
      "Rodillas hacia fuera.",
    ],
  },
  "sentadilla-hack": {
    instructions: [
      "Apoya la espalda y los hombros en la máquina con los pies a la anchura de la cadera en la plataforma.",
      "Suelta los seguros y estira las piernas.",
      "Baja flexionando las rodillas hasta al menos la paralela.",
      "Empuja la plataforma con todo el pie hasta casi estirar las piernas.",
    ],
    tips: [
      "Espalda pegada al respaldo.",
      "Rodillas en la línea de los pies.",
      "No bloquees las rodillas arriba.",
    ],
  },
  "prensa": {
    instructions: [
      "Siéntate con la espalda apoyada y los pies a la anchura de los hombros en la plataforma.",
      "Empuja la plataforma y suelta los seguros.",
      "Baja flexionando las rodillas hasta unos 90° o más, sin despegar la cadera del asiento.",
      "Empuja con todo el pie hasta casi estirar las piernas.",
    ],
    tips: [
      "La cadera no se despega del asiento.",
      "No bloquees las rodillas arriba.",
      "Rodillas en la línea de los pies.",
    ],
  },
  "zancadas": {
    instructions: [
      "Ponte de pie con una mancuerna en cada mano a los lados.",
      "Da un paso largo al frente con una pierna.",
      "Baja hasta que la rodilla trasera casi toque el suelo, con el torso erguido.",
      "Empuja con el pie delantero para volver y repite con la otra pierna.",
    ],
    tips: [
      "Paso largo y estable.",
      "Rodilla delantera en la línea del pie.",
      "Torso erguido.",
    ],
  },
  "sentadilla-bulgara": {
    instructions: [
      "Ponte de espaldas a un banco y apoya sobre él el empeine del pie trasero.",
      "Sujeta una mancuerna en cada mano con el pie delantero bien adelantado.",
      "Baja en vertical hasta que el muslo delantero quede paralelo al suelo.",
      "Empuja con el pie delantero hasta subir.",
    ],
    tips: [
      "El peso va en la pierna delantera.",
      "Rodilla delantera en la línea del pie.",
      "Busca una distancia estable antes de empezar.",
    ],
  },
  "extension-cuadriceps": {
    instructions: [
      "Ajusta el respaldo para que las rodillas queden alineadas con el eje de la máquina.",
      "Coloca el rodillo sobre la parte baja de las tibias y agarra las asas.",
      "Estira las piernas hasta casi bloquear las rodillas.",
      "Baja despacio sin dejar caer el peso.",
    ],
    tips: [
      "Rodillas alineadas con el eje.",
      "Pausa breve arriba.",
      "No despegues la cadera del asiento.",
    ],
  },
  // Hamstrings
  "peso-muerto-rumano": {
    instructions: [
      "Ponte de pie con la barra en las manos, agarre a la anchura de los hombros.",
      "Flexiona un poco las rodillas y mantenlas así todo el movimiento.",
      "Lleva la cadera atrás y baja la barra pegada a las piernas con la espalda neutra.",
      "Para cuando la cadera deje de ir hacia atrás y notes estiramiento en los isquios.",
      "Sube empujando la cadera al frente hasta quedar de pie.",
    ],
    tips: [
      "Cadera atrás, no hacia abajo.",
      "Barra pegada a las piernas.",
      "Rodillas suaves y fijas.",
      "Evita redondear la espalda al final.",
    ],
  },
  "buenos-dias": {
    instructions: [
      "Coloca la barra sobre los trapecios como en la sentadilla.",
      "Pon los pies a la anchura de la cadera con las rodillas algo flexionadas.",
      "Inclina el torso llevando la cadera atrás con la espalda neutra.",
      "Para cuando notes estiramiento en los isquios y sube empujando la cadera al frente.",
    ],
    tips: [
      "Es una bisagra de cadera, no una sentadilla.",
      "Espalda neutra todo el tiempo.",
      "Empieza con poco peso.",
    ],
  },
  "curl-femoral-tumbado": {
    instructions: [
      "Túmbate boca abajo con las rodillas justo por fuera del banco y alineadas con el eje.",
      "Coloca el rodillo sobre los tobillos y agarra las asas.",
      "Flexiona las rodillas llevando los talones hacia los glúteos.",
      "Baja despacio hasta casi estirar las piernas.",
    ],
    tips: [
      "Cadera pegada al banco.",
      "Controla la bajada.",
      "Sin dar tirones.",
    ],
  },
  "curl-femoral-sentado": {
    instructions: [
      "Ajusta el respaldo para que las rodillas queden alineadas con el eje de la máquina.",
      "Coloca el rodillo bajo los tobillos y baja el apoyo sobre los muslos.",
      "Flexiona las rodillas llevando los talones hacia abajo y atrás.",
      "Vuelve despacio hasta casi estirar las piernas.",
    ],
    tips: [
      "Muslos bien sujetos.",
      "Inclina el torso un poco hacia delante.",
      "Rango completo y controlado.",
    ],
  },
  // Glutes
  "hip-thrust": {
    instructions: [
      "Apoya la parte alta de la espalda en un banco con la barra sobre la cadera.",
      "Pon los pies a la anchura de la cadera, de modo que las tibias queden verticales arriba.",
      "Empuja con los talones y sube la cadera hasta alinear tronco y muslos.",
      "Aprieta los glúteos arriba y baja controlado.",
    ],
    tips: [
      "Barbilla hacia el pecho.",
      "Tibias verticales arriba.",
      "No arquees la zona lumbar al subir.",
    ],
  },
  "puente-gluteo": {
    instructions: [
      "Túmbate boca arriba con las rodillas flexionadas y los pies apoyados cerca de los glúteos.",
      "Coloca los brazos a los lados y tensa el abdomen.",
      "Empuja con los talones y sube la cadera hasta alinear tronco y muslos.",
      "Aprieta los glúteos arriba y baja despacio.",
    ],
    tips: [
      "Empuja con los talones.",
      "Pausa de un segundo arriba.",
      "No arquees la espalda.",
    ],
  },
  "patada-gluteo-polea": {
    instructions: [
      "Coloca la tobillera en la polea baja y ajústala a un tobillo.",
      "Sujétate a la máquina con el torso algo inclinado y el abdomen firme.",
      "Lleva la pierna hacia atrás estirando la cadera.",
      "Vuelve despacio sin dejar que el peso toque abajo.",
    ],
    tips: [
      "Mueve la cadera, no la espalda.",
      "Aprieta el glúteo al final.",
      "Sin balanceo.",
    ],
  },
  "abduccion-cadera": {
    instructions: [
      "Siéntate en la máquina con la espalda apoyada y los muslos por dentro de los apoyos.",
      "Agarra las asas y mantén la cadera pegada al asiento.",
      "Abre las piernas hacia fuera lo más que puedas.",
      "Vuelve despacio sin dejar que las placas choquen.",
    ],
    tips: [
      "Pausa breve al abrir.",
      "Controla la vuelta.",
      "Inclinarte un poco al frente carga más el glúteo.",
    ],
  },
  // Calves
  "elevacion-talones-pie": {
    instructions: [
      "Coloca los hombros bajo los apoyos de la máquina y las puntas de los pies en el borde de la plataforma.",
      "Estira las piernas con las rodillas rectas pero sin bloquear.",
      "Baja los talones hasta notar estiramiento en los gemelos.",
      "Sube de puntillas lo más alto posible y vuelve despacio.",
    ],
    tips: [
      "Pausa abajo, sin rebotar.",
      "Rango completo, arriba y abajo.",
      "Rodillas quietas.",
    ],
  },
  "elevacion-talones-sentado": {
    instructions: [
      "Siéntate en la máquina con el apoyo sobre los muslos, cerca de las rodillas.",
      "Coloca las puntas de los pies en el borde de la plataforma.",
      "Baja los talones hasta notar estiramiento.",
      "Sube de puntillas lo más alto posible y vuelve despacio.",
    ],
    tips: [
      "Pausa abajo, sin rebotar.",
      "Rango completo.",
      "Movimiento lento y controlado.",
    ],
  },
  // Core
  "crunch-polea": {
    instructions: [
      "Coloca la polea alta con una cuerda y arrodíllate de frente a ella.",
      "Sujeta la cuerda junto a la cabeza.",
      "Flexiona el tronco llevando los codos hacia los muslos, redondeando la espalda.",
      "Vuelve despacio hasta estirar el tronco sin mover la cadera.",
    ],
    tips: [
      "La cadera queda quieta.",
      "Enrolla la columna, no tires con los brazos.",
      "Exhala al bajar.",
    ],
  },
  "elevacion-piernas-colgado": {
    instructions: [
      "Cuélgate de una barra con los brazos estirados y los hombros activos.",
      "Tensa el abdomen y evita balancearte.",
      "Sube las piernas hasta la horizontal o más, inclinando la pelvis hacia arriba.",
      "Baja despacio sin perder el control.",
    ],
    tips: [
      "Sin balanceo.",
      "Inclina la pelvis al final.",
      "Rodillas flexionadas si te cuesta.",
    ],
  },
  "rueda-abdominal": {
    instructions: [
      "Arrodíllate en el suelo y sujeta la rueda bajo los hombros.",
      "Tensa el abdomen y los glúteos con la pelvis algo metida.",
      "Rueda hacia delante estirando el cuerpo hasta donde controles la zona lumbar.",
      "Vuelve tirando con el abdomen hasta la posición inicial.",
    ],
    tips: [
      "Evita hundir la zona lumbar.",
      "Recorrido corto al principio.",
      "Glúteos apretados.",
    ],
  },
  "press-pallof": {
    instructions: [
      "Coloca la polea a la altura del pecho y ponte de lado con el asa en ambas manos.",
      "Separa un poco de la polea con el asa pegada al pecho y los pies firmes.",
      "Empuja el asa al frente hasta estirar los brazos sin dejar que el tronco gire.",
      "Mantén un instante y vuelve el asa al pecho.",
    ],
    tips: [
      "Resiste el giro.",
      "Cadera y hombros mirando al frente.",
      "Abdomen y glúteos firmes.",
    ],
  },
  // Full body
  "swing-kettlebell": {
    instructions: [
      "Coloca la kettlebell un poco por delante, con los pies algo más abiertos que la cadera.",
      "Agárrala con ambas manos, lleva la cadera atrás y lánzala entre las piernas.",
      "Extiende la cadera con fuerza para proyectarla al frente hasta la altura del pecho.",
      "Deja que baje y acompáñala llevando la cadera atrás para la siguiente repetición.",
    ],
    tips: [
      "Es un empuje de cadera, no una sentadilla.",
      "Los brazos solo guían la kettlebell.",
      "Aprieta glúteos arriba.",
      "Evita redondear la espalda.",
    ],
  },
  "cargada-potencia": {
    instructions: [
      "Colócate como en el peso muerto, con la barra sobre la mitad del pie y agarre algo más abierto que las piernas.",
      "Sube la barra pegada al cuerpo hasta por encima de las rodillas con la espalda firme.",
      "Extiende con fuerza la cadera y las rodillas, y encoge los hombros.",
      "Métete bajo la barra girando rápido los codos al frente y recíbela en los hombros.",
      "Recíbela con las rodillas algo flexionadas y ponte de pie.",
    ],
    tips: [
      "Barra pegada al cuerpo.",
      "Extiende la cadera antes de tirar con los brazos.",
      "Codos rápidos al frente.",
      "Aprende la técnica con poco peso.",
    ],
  },
  "remo-banda": {
    instructions: [
      "Siéntate con las piernas estiradas y pasa la banda por la planta de los pies.",
      "Agarra los extremos con los brazos estirados y la espalda recta.",
      "Tira llevando los codos atrás pegados al cuerpo hasta juntar las escápulas.",
      "Vuelve despacio hasta estirar los brazos.",
    ],
    tips: ["Junta las escápulas al final.", "No eches el tronco atrás."],
  },
  "elevaciones-laterales-maquina": {
    instructions: [
      "Ajusta el asiento para que el eje de la máquina quede a la altura de tus hombros.",
      "Apoya los antebrazos o agarra las asas con los codos algo flexionados.",
      "Sube los brazos hacia los lados hasta la altura de los hombros.",
      "Baja despacio sin dejar que el peso toque abajo.",
    ],
    tips: ["Sube con los codos, no con las manos.", "No encojas los hombros."],
  },
  "pajaros-maquina": {
    instructions: [
      "Siéntate mirando al respaldo de la máquina con el pecho apoyado.",
      "Agarra las asas con los brazos estirados a la altura de los hombros.",
      "Abre los brazos hacia atrás hasta quedar en cruz.",
      "Vuelve despacio al frente.",
    ],
    tips: ["Codos ligeramente flexionados.", "Piensa en llevar las manos lejos, no atrás."],
  },
  "face-pull-banda": {
    instructions: [
      "Ata la banda a la altura de la cara y agarra los extremos con las palmas hacia abajo.",
      "Da un paso atrás hasta tensar la banda con los brazos estirados.",
      "Tira hacia la cara separando las manos y llevando los codos altos.",
      "Vuelve despacio hasta estirar los brazos.",
    ],
    tips: ["Codos a la altura de los hombros.", "Gira las manos hacia fuera al final."],
  },
  "curl-maquina": {
    instructions: [
      "Ajusta el asiento para que los codos queden alineados con el eje de la máquina.",
      "Apoya la parte de atrás de los brazos en el soporte y agarra las asas.",
      "Sube flexionando los codos hasta contraer el bíceps.",
      "Baja despacio hasta casi estirar los brazos.",
    ],
    tips: ["No despegues los brazos del soporte.", "Baja en dos o tres segundos."],
  },
  "curl-banda": {
    instructions: [
      "Pisa la banda con ambos pies y agarra los extremos con las palmas al frente.",
      "Con los codos pegados al cuerpo, sube las manos hacia los hombros.",
      "Aprieta arriba un segundo.",
      "Baja despacio hasta estirar los brazos.",
    ],
    tips: ["Codos quietos a los lados.", "No balancees el cuerpo."],
  },
  "extension-triceps-maquina": {
    instructions: [
      "Ajusta el asiento para que los codos queden alineados con el eje de la máquina.",
      "Apoya los brazos en el soporte y agarra las asas con los codos flexionados.",
      "Extiende los codos hasta estirar los brazos.",
      "Vuelve despacio sin dejar que el peso toque abajo.",
    ],
    tips: ["Mueve solo los antebrazos.", "Bloquea un instante abajo."],
  },
  "extension-triceps-banda": {
    instructions: [
      "Ata la banda arriba y agarra los extremos con los codos pegados al cuerpo.",
      "Empuja hacia abajo hasta estirar los brazos.",
      "Abre ligeramente las manos al final.",
      "Sube despacio hasta que los antebrazos queden paralelos al suelo.",
    ],
    tips: ["Codos quietos junto al cuerpo.", "Tronco ligeramente inclinado, sin balanceo."],
  },
  "crunch-maquina": {
    instructions: [
      "Ajusta el asiento y apoya el pecho o agarra las asas según la máquina.",
      "Encorva el tronco llevando el pecho hacia la cadera.",
      "Aprieta el abdomen un segundo abajo.",
      "Vuelve despacio sin soltar la tensión.",
    ],
    tips: ["Encorva la espalda, no tires con los brazos.", "Exhala al bajar."],
  },
  caminadora: {
    instructions: [
      "Sube a la cinta parado sobre los laterales y arranca a velocidad lenta.",
      "Ponte en el centro de la cinta y sube la velocidad y la inclinación poco a poco.",
      "Mantén el ritmo del objetivo: zona de pulso, velocidad o inclinación.",
      "Al final baja la velocidad dos o tres minutos para enfriar.",
    ],
    tips: ["No te agarres a las barras con inclinación.", "Pasos cortos y cómodos."],
  },
  eliptica: {
    instructions: [
      "Sube a los pedales y agarra las asas móviles.",
      "Empieza a pedalear suave y ajusta el nivel de resistencia.",
      "Empuja y tira de las asas a la vez que pedaleas, con la espalda recta.",
      "Baja la resistencia los últimos minutos para enfriar.",
    ],
    tips: ["Apoya todo el pie en el pedal.", "No te apoyes con el peso en las asas."],
  },
  "bici-estatica": {
    instructions: [
      "Ajusta el sillín a la altura de la cadera y el manillar a tu medida.",
      "Pedalea suave unos minutos para calentar.",
      "Sube la resistencia hasta la zona o el nivel del objetivo.",
      "Termina con unos minutos suaves.",
    ],
    tips: ["Rodilla casi estirada abajo.", "Cadencia constante, sin rebotar en el sillín."],
  },
  "remo-ergometro": {
    instructions: [
      "Siéntate, sujeta los pies con las correas y agarra el mango.",
      "Empuja primero con las piernas, luego inclina el tronco atrás y tira del mango al abdomen.",
      "Vuelve en orden inverso: brazos, tronco y piernas.",
      "Mantén un ritmo constante de paladas.",
    ],
    tips: ["Piernas, tronco, brazos; y al volver al revés.", "Espalda recta, sin encorvarte."],
  },
  escaladora: {
    instructions: [
      "Sube a los escalones agarrándote a las barras y arranca a nivel bajo.",
      "Sube el nivel hasta el ritmo del objetivo.",
      "Pisa con todo el pie y mantén el tronco erguido.",
      "Baja el nivel al final para enfriar.",
    ],
    tips: ["No cargues el peso en los brazos.", "Pasos completos, no de puntillas."],
  },
  correr: {
    instructions: [
      "Calienta caminando y trotando suave cinco minutos.",
      "Corre al ritmo del objetivo con pasos cortos y ligeros.",
      "Mantén la mirada al frente y los hombros relajados.",
      "Termina caminando unos minutos.",
    ],
    tips: ["Si no puedes hablar en zona 2, ve más despacio.", "Cadencia alta, zancada corta."],
  },
  caminar: {
    instructions: [
      "Sal a buen paso con la espalda recta.",
      "Balancea los brazos de forma natural.",
      "Mantén un ritmo en el que puedas hablar sin ahogarte.",
      "Sube el ritmo o busca cuestas para más intensidad.",
    ],
    tips: ["Pisa de talón a punta.", "Hombros relajados."],
  },
  "saltar-cuerda": {
    instructions: [
      "Agarra los mangos con los codos cerca del cuerpo.",
      "Gira la cuerda con las muñecas, no con los brazos.",
      "Salta bajito sobre la punta de los pies justo para que pase la cuerda.",
      "Alterna bloques de saltos con pausas cortas si lo pide el objetivo.",
    ],
    tips: ["Saltos de pocos centímetros.", "Rodillas algo flexionadas al caer."],
  },
  hiit: {
    instructions: [
      "Calienta cinco minutos con movimientos suaves.",
      "Haz cada bloque de trabajo a máxima intensidad sostenible: burpees, sprints o saltos.",
      "Recupera en la pausa caminando o muy suave.",
      "Repite las rondas del objetivo y termina con unos minutos suaves.",
    ],
    tips: ["La calidad del movimiento antes que la velocidad.", "Si la técnica se rompe, alarga la pausa."],
  },
};
