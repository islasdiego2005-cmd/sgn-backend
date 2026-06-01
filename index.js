const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const pool = require('./db');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// LOGIN DE USUARIOS
app.post('/api/auth/login', async (req, res) => {

    const { num_control, password } = req.body;

    // Validación básica
    if (!num_control || !password) {
        return res.status(400).json({
            error: 'Por favor ingresa matrícula y contraseña.'
        });
    }

    try {
        // Buscar usuario (Adaptado a PostgreSQL)
        const result = await pool.query(
            `
            SELECT *
            FROM usuarios
            WHERE num_control = $1
            `,
            [num_control]
        );

        // Verificar existencia (En pg se usa rows.length)
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Usuario no encontrado.'
            });
        }

        // Obtener el primer usuario (Adaptado a PostgreSQL)
        const usuario = result.rows[0];

        // Comparar contraseña
        const passwordCorrecta = await bcrypt.compare(
            password,
            usuario.password_hash
        );

        if (!passwordCorrecta) {
            return res.status(401).json({
                error: 'Contraseña incorrecta.'
            });
        }

        // Login exitoso
        res.json({
            mensaje: 'Inicio de sesión exitoso',
            usuario: {
                num_control: usuario.num_control,
                nombre_completo: usuario.nombre_completo,
                rol: usuario.rol
            }
        });

    } catch (err) {

        console.error('Error en login:', err);

        res.status(500).json({
            error: 'Error interno del servidor.'
        });

    }

});

app.get('/crear-admin', async (req, res) => {

    const bcrypt = require('bcryptjs');

    const passwordHash = await bcrypt.hash('123456', 10);

    await pool.query(`
        INSERT INTO usuarios
        (num_control, nombre_completo, rol, password_hash, estatus, cursos)
        VALUES ($1, $2, $3, $4, $5, $6)
    `, [
        'admin01',
        'Administrador General',
        'Administrador',
        passwordHash,
        'Apto',
        'Ninguno'
    ]);

    res.send('Admin creado');
});

// RUTA PARA OBTENER ESPECIALIDADES DISPONIBLES EN CONVOCATORIAS ABIERTAS
app.get('/api/convocatorias/disponibles', async (req, res) => {
    try {

        // Consulta directa adaptada a PostgreSQL
        const result = await pool.query(`
            SELECT DISTINCT puesto_requerido 
            FROM convocatorias 
            WHERE estatus = 'Abierta'
        `);

        // Mapeamos el resultado usando result.rows 
        const especialidades = result.rows.map(row => row.puesto_requerido);
        res.json(especialidades);
    } catch (err) {
        console.error("Error al obtener especialidades disponibles:", err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// OBTENER CURSOS DEL TRABAJADOR
app.get('/api/trabajadores/:num_control/cursos', async (req, res) => {
    const { num_control } = req.params;

    try {

        // Buscar el campo cursos (Adaptado a PostgreSQL con $1)
        const result = await pool.query(
            `
            SELECT cursos
            FROM usuarios
            WHERE num_control = $1
            `,
            [num_control]
        );

        // Verificar existencia usando result.rows
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Trabajador no encontrado'
            });
        }

        // Obtener el registro usando result.rows[0]
        const cursosTexto = result.rows[0].cursos || '';

        const cursosArray = cursosTexto
            .split(',')
            .map(c => c.trim())
            .filter(c => c !== '');

        res.json(cursosArray);

    } catch (err) {
        console.error("Error al obtener cursos:", err);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

//  RUTA PARA OBTENER EL PERSONAL DE APOYO
app.get('/api/apoyo', async (req, res) => {
    try {

        const result = await pool.query(`
            SELECT *
            FROM personal_apoyo
        `);

        res.json(result.rows);

    } catch (err) {

        console.error("ERROR APOYO:", err);

        res.status(500).json({
            error: err.message
        });

    }
});

// 1. RUTA PARA VER LOS NOMBRAMIENTOS CON SUS DETALLES REALES (CORREGIDA)
app.get('/api/nombramientos', async (req, res) => {
    try {

        // Consulta directa adaptada a PostgreSQL
        const result = await pool.query(`
            SELECT 
                n.id_nombramiento,
                n.codigo_nombramiento,
                n.barco,
                n.turno,
                n.fecha_carga,
                n.fecha_cierre, 
                n.muelle, 
                n.estado,
                d.id_detalle,
                d.puesto,
                d.cantidad
            FROM nombramientos n
            LEFT JOIN detalle_nombramiento d ON n.id_nombramiento = d.id_nombramiento
	    ORDER BY n.id_nombramiento DESC
        `);


        const nombramientosAgrupados = [];

        // Agrupación usando result.rows
        result.rows.forEach(row => {
            let nombramiento = nombramientosAgrupados.find(n => n.id_nombramiento === row.id_nombramiento);

            if (!nombramiento) {
                nombramiento = {
                    id_nombramiento: row.id_nombramiento,
                    codigo_nombramiento: row.codigo_nombramiento,
                    barco: row.barco,
                    turno: row.turno,
                    fecha_carga: row.fecha_carga,
                    fecha_cierre: row.fecha_cierre,
                    muelle: row.muelle,
                    estado: row.estado,
                    vacantes: [] // Sincronizado para el Frontend
                };
                nombramientosAgrupados.push(nombramiento);
            }

            if (row.id_detalle) {
                nombramiento.vacantes.push({
                    id_detalle: row.id_detalle,
                    puesto: row.puesto,
                    cantidad: row.cantidad
                });
            }
        });

        res.json(nombramientosAgrupados);
    } catch (err) {
        console.error("Error al obtener nombramientos:", err);
        res.status(500).send(err.message);
    }
});


// 5. RUTA PARA CREAR NOMBRAMIENTO Y SUS CONVOCATORIAS
app.post('/api/nombramientos/crear', async (req, res) => {
    const { codigo_nombramiento, barco, turno, fecha_carga, fecha_cierre, muelle, vacantes } = req.body;

    if (!codigo_nombramiento || !barco || !turno || !fecha_carga || !fecha_cierre || !muelle || !vacantes || vacantes.length === 0) {
        return res.status(400).json({ error: 'Faltan datos obligatorios para crear el nombramiento.' });
    }

    // --- VALIDACIONES DE FECHAS Y TURNOS ---
    const fCarga = new Date(fecha_carga);
    const fCierre = new Date(fecha_cierre);
    const tresMesesEnMs = 90 * 24 * 60 * 60 * 1000;
    
    if (fCierre <= fCarga) {
        return res.status(400).json({ error: 'La fecha de cierre debe ser posterior a la de carga.' });
    }
    
    if ((fCierre - fCarga) > tresMesesEnMs) {
        return res.status(400).json({ error: 'La duración del nombramiento no puede exceder los 3 meses.' });
    }

    const hora = fCarga.getHours();
    if (turno === '1er Turno (Noche)' && (hora >= 6 && hora < 20)) {
         return res.status(400).json({ error: 'Para el turno de noche, la hora debe ser nocturna.' });
    }
    // -------------------------------------------------


    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const nombramientoResult = await client.query(`
            INSERT INTO nombramientos (codigo_nombramiento, barco, turno, fecha_carga, fecha_creacion, estado, fecha_cierre, muelle) 
            VALUES ($1, $2, $3, $4, NOW(), 'Abierta', $5, $6)
            RETURNING id_nombramiento
        `, [codigo_nombramiento, barco, turno, fecha_carga, fecha_cierre, muelle]);

        const id_nombramiento = nombramientoResult.rows[0].id_nombramiento;

        for (let vacante of vacantes) {
            await client.query(`
                INSERT INTO detalle_nombramiento (id_nombramiento, puesto, cantidad)
                VALUES ($1, $2, $3)
            `, [id_nombramiento, vacante.puesto, vacante.cantidad]);

            await client.query(`
                INSERT INTO convocatorias (id_nombramiento, puesto_requerido, cantidad_vacantes, estatus, fecha_creacion)
                VALUES ($1, $2, $3, 'Abierta', NOW())
            `, [id_nombramiento, vacante.puesto, vacante.cantidad]);
        }

        await client.query('COMMIT');
        res.status(201).json({ mensaje: 'Nombramiento creado exitosamente.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Error en la transacción de guardado:", err);
        res.status(500).json({ error: 'Error en el servidor al crear el nombramiento: ' + err.message });
    } finally {
        client.release();
    }
});

//CREAR NOMBRAMIENTO

app.post('/api/nombramientos/crear', async (req, res) => {
    // ... todo tu código aquí adentro ...
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // ... tu lógica ...
        await client.query('COMMIT');
        res.status(201).json({ mensaje: 'Éxito' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}); 

// BORRAR DESTINO
app.delete('/api/destinos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM destino WHERE id_destino = $1', [req.params.id]);
        res.json({ mensaje: 'Borrado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. RUTA PARA TRAER LOS TRABAJADORES A LA TABLA REACT
app.get('/api/trabajadores', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT num_control, nombre_completo, nombre, apellido_paterno, apellido_materno, estatus, cursos 
            FROM usuarios 
            WHERE rol = 'Trabajador'
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener trabajadores:", err);
        res.status(500).send(err.message);
    }
});

// 3. RUTA PARA REGISTRAR TRABAJADORES / USUARIOS
app.post('/api/auth/register', async (req, res) => {
    const { num_control, nombre_completo, nombre, apellido_paterno, apellido_materno, rol, password, cursos } = req.body;

    if (!num_control || !nombre_completo || !rol || !password) {
        return res.status(400).json({ error: 'Por favor, ingresa todos los campos obligatorios.' });
    }

    try {
        const usuarioExistente = await pool.query('SELECT * FROM usuarios WHERE num_control = $1', [num_control]);
        if (usuarioExistente.rows.length > 0) {
            return res.status(400).json({ error: 'La matricula o numero de control ya esta registrado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const cursosTexto = cursos && cursos.length > 0 ? cursos.join(', ') : 'Ninguno';

        await pool.query(`
            INSERT INTO usuarios (num_control, nombre_completo, nombre, apellido_paterno, apellido_materno, rol, password_hash, estatus, cursos) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [num_control, nombre_completo, nombre, apellido_paterno, apellido_materno, rol, passwordHash, 'Apto', cursosTexto]);

        res.status(201).json({ mensaje: 'Usuario registrado exitosamente.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error en el servidor: ' + err.message });
    }
});

// 4. RUTA PARA ACTUALIZAR LOS DATOS DE UN TRABAJADOR
app.put('/api/trabajadores/:num_control', async (req, res) => {
    const { num_control } = req.params;
    const { nombre_completo, nombre, apellido_paterno, apellido_materno, estatus, cursos } = req.body;

    if (!nombre_completo || !estatus) {
        return res.status(400).json({ error: 'El nombre completo y el estatus son obligatorios.' });
    }

    try {
        await pool.query(`
            UPDATE usuarios 
            SET nombre_completo = $1, 
                nombre = $2,
                apellido_paterno = $3,
                apellido_materno = $4,
                estatus = $5, 
                cursos = $6 
            WHERE num_control = $7
        `, [nombre_completo, nombre, apellido_paterno, apellido_materno, estatus, cursos, num_control]);

        res.json({ mensaje: 'Trabajador actualizado con exito en la base de datos.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error en el servidor al actualizar: ' + err.message });
    }
});

// RUTA PARA OBTENER LOS DETALLES REALES EN TEXTO DIRECTO
app.get('/api/nombramientos/:id/detalles', async (req, res) => {
    const { id } = req.params;
    try {
        // Adaptado a pool.query con arreglo de parámetros y mapeo a result.rows
        const result = await pool.query(`
            SELECT puesto AS nombre_especialidad, cantidad 
            FROM detalle_nombramiento
            WHERE id_nombramiento = $1
        `, [id]);

        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener los detalles del nombramiento:", err);
        res.status(500).json({ error: "Error al traer detalles de la base de datos." });
    }
});

// VERIFICAR SI EL TRABAJADOR YA SE POSTULÓ A LA CONVOCATORIA ACTIVA
app.get('/api/trabajadores/:num_control/postulacion-activa', async (req, res) => {
    try {
        const { num_control } = req.params;

        // BUSCAR CONVOCATORIAS ABIERTAS
        const convocatoriasResult = await pool.query(`
            SELECT id_convocatoria
            FROM convocatorias
            WHERE estatus = 'Abierta'
        `);

        // Si no hay convocatorias abiertas usando rows.length
        if (convocatoriasResult.rows.length === 0) {
            return res.json({
                yaPostulado: false
            });
        }

        // IDs de convocatorias abiertas mapeadas desde rows
        const idsConvocatorias = convocatoriasResult.rows.map(c => c.id_convocatoria);

        // VERIFICAR SI YA SE POSTULÓ EN ALGUNA CONVOCATORIA ABIERTA
        const postulacionResult = await pool.query(`
            SELECT id_postulacion
            FROM postulaciones
            WHERE num_control = $1
            AND id_convocatoria = ANY($2)
            LIMIT 1
            `, [num_control, idsConvocatorias]);
        res.json({
            yaPostulado: postulacionResult.rows.length > 0
        });

    } catch (error) {
        console.error('Error verificando postulacion activa:', error);
        res.status(500).json({
            error: 'Error verificando postulacion activa'
        });
    }
});

// RECUPERAR CONTRASEÑA SIMPLE
app.post('/api/auth/recuperar-password', async (req, res) => {
    const { num_control, nuevaPassword } = req.body;

    if (!num_control || !nuevaPassword) {
        return res.status(400).json({
            error: 'Faltan datos.'
        });
    }

    try {

        // Verificar usuario en Postgres (rows)
        const usuarioResult = await pool.query(`
            SELECT *
            FROM usuarios
            WHERE num_control = $1
        `, [num_control]);

        if (usuarioResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Usuario no encontrado.'
            });
        }

        // Crear nuevo hash
        const nuevoHash = await bcrypt.hash(nuevaPassword, 10);

        // Actualizar password con parámetros planos ($1, $2)
        await pool.query(`
            UPDATE usuarios
            SET password_hash = $1
            WHERE num_control = $2
        `, [nuevoHash, num_control]);

        res.json({
            mensaje: 'Contrasena actualizada correctamente.'
        });

    } catch (err) {
        console.error('Error recuperando contrasena:', err);
        res.status(500).json({
            error: 'Error del servidor.'
        });
    }
});


// ========================================================
// GUARDAR RESULTADOS DEL LLAMADO 
// ========================================================
app.put('/api/postulaciones/resultado', async (req, res) => {
    const { id_nombramiento, seleccionados } = req.body;

    if (!id_nombramiento) {
        return res.status(400).json({ error: 'Falta el ID del nombramiento.' });
    }

    if (!seleccionados || seleccionados.length === 0) {
        return res.status(400).json({ error: 'No hay seleccionados.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. RECHAZAMOS A LOS QUE NO FUERON SELECCIONADOS EN ESTA RONDA (Los que siguen en Pendiente)
        await client.query(`
            UPDATE postulaciones p
            SET resultado = 'Rechazado'
            FROM convocatorias c
            WHERE p.id_convocatoria = c.id_convocatoria
            AND c.id_nombramiento = $1
            AND p.resultado = 'Pendiente'
        `, [id_nombramiento]);

        // 2. ACTUALIZAMOS O INSERTAMOS A LOS SELECCIONADOS COMO 'Llamado'
        for (const trabajador of seleccionados) {
            const existePostulacion = await client.query(`
                SELECT p.id_postulacion 
                FROM postulaciones p
                INNER JOIN convocatorias c ON p.id_convocatoria = c.id_convocatoria
                WHERE c.id_nombramiento = $1 
                AND p.num_control = $2 
                AND c.puesto_requerido = $3
                LIMIT 1
            `, [id_nombramiento, trabajador.num_control, trabajador.puesto]);

            if (existePostulacion.rows.length > 0) {
                await client.query(`
                    UPDATE postulaciones 
                    SET resultado = 'Llamado' 
                    WHERE id_postulacion = $1
                `, [existePostulacion.rows[0].id_postulacion]);
            } else {
                // Si es Extra o de Apoyo (No existía en postulaciones)
                const convResult = await client.query(`
                    SELECT id_convocatoria FROM convocatorias 
                    WHERE id_nombramiento = $1 AND puesto_requerido = $2
                    LIMIT 1
                `, [id_nombramiento, trabajador.puesto]);

                if (convResult.rows.length > 0) {
                    await client.query(`
                        INSERT INTO postulaciones (id_convocatoria, num_control, fecha_postulacion, resultado)
                        VALUES ($1, $2, NOW(), 'Llamado')
                    `, [convResult.rows[0].id_convocatoria, trabajador.num_control]);
                }
            }
        }

        await client.query('COMMIT');
        res.json({ mensaje: 'Personal llamado exitosamente. Proceda a confirmar asistencia en Recepción.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Error crítico guardando llamados:", err);
        res.status(500).json({ error: 'Error al procesar el llamado en la base de datos.' });
    } finally {
        client.release();
    }
});

// VER RESULTADO DEL TRABAJADOR
app.get('/api/trabajadores/:num_control/resultado', async (req, res) => {
    const { num_control } = req.params;

    try {

        // Se cambió SELECT TOP 1 por LIMIT 1 al final
        const result = await pool.query(`
            SELECT resultado
            FROM postulaciones
            WHERE num_control = $1
            AND resultado != 'Pendiente'
            AND resultado != 'No seleccionado'
            LIMIT 1
        `, [num_control]);

        if (result.rows.length === 0) {
            return res.json({
                resultado: null
            });
        }

        res.json({
            resultado: result.rows[0].resultado
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: 'Error obteniendo resultado'
        });
    }
});

// 7. RUTA PARA PROCESAR LAS POSTULACIONES 
app.post('/api/postulaciones/crear', async (req, res) => {
    const { num_control, puestos } = req.body;

    if (!num_control || !puestos || !Array.isArray(puestos) || puestos.length === 0) {
        return res.status(400).json({ error: 'Faltan datos obligatorios (Matricula o Puestos seleccionados).' });
    }

    try {
        const usuarioResult = await pool.query(
            'SELECT estatus, cursos, nombre_completo FROM usuarios WHERE num_control = $1',
            [num_control]
        );

        if (usuarioResult.rows.length === 0) {
            return res.status(404).json({ error: 'El trabajador no existe en el sistema.' });
        }

        const { estatus: estatus_usuario, cursos } = usuarioResult.rows[0];

        if (estatus_usuario !== 'Apto') {
            return res.status(400).json({ error: `Tu estatus actual es '${estatus_usuario}'. No puedes postularte hasta estar Apto.` });
        }

        const listaCursos = cursos ? cursos.split(',').map(c => c.trim()) : [];

        let postulacionesExitosas = 0;
        let erroresDetallados = [];

        for (let puesto of puestos) {
            if (!listaCursos.includes(puesto)) {
                erroresDetallados.push(`No cuentas con la certificacion para el puesto: ${puesto}`);
                continue;
            }

            // Adaptado con LIMIT 1 al final
            const convocatoriaResult = await pool.query(`
                SELECT id_convocatoria 
                FROM convocatorias 
                WHERE puesto_requerido = $1 AND estatus = 'Abierta'
                ORDER BY fecha_creacion DESC
                LIMIT 1
            `, [puesto]);

            if (convocatoriaResult.rows.length === 0) {
                erroresDetallados.push(`No hay ninguna convocatoria activa o abierta para: ${puesto}`);
                continue;
            }

            const id_convocatoria = convocatoriaResult.rows[0].id_convocatoria;

            const duplicadoResult = await pool.query(
                'SELECT id_postulacion FROM postulaciones WHERE id_convocatoria = $1 AND num_control = $2',
                [id_convocatoria, num_control]
            );

            if (duplicadoResult.rows.length > 0) {
                erroresDetallados.push(`Ya estas inscrito en la convocatoria vigente de: ${puesto}`);
                continue;
            }

            // Adaptado con NOW() para registrar la fecha del sistema en Postgres
            await pool.query(`
                INSERT INTO postulaciones (id_convocatoria, num_control, fecha_postulacion, resultado)
                VALUES ($1, $2, NOW(), 'Pendiente')
            `, [id_convocatoria, num_control]);

            postulacionesExitosas++;
        }

        if (postulacionesExitosas === 0) {
            return res.status(400).json({
                error: 'No se pudo concretar ninguna postulacion.',
                detalles: erroresDetallados
            });
        }

        return res.status(201).json({
            mensaje: `Postulacion completada! Te registraste con exito en (${postulacionesExitosas}) vacante(s).`,
            avisos: erroresDetallados
        });

    } catch (err) {
        console.error("Error critico en bloque de postulaciones masivas:", err);
        return res.status(500).json({ error: 'Error interno en el servidor: ' + err.message });
    }
});

// 8. RUTA PARA VER QUÉ TRABAJADORES SE POSTULARON A UN NOMBRAMIENTO
app.get('/api/nombramientos/:id_nombramiento/postulados', async (req, res) => {
    const { id_nombramiento } = req.params;

    try {
        const result = await pool.query(`
            SELECT 
                p.id_postulacion,
                p.num_control,
                COALESCE(u.nombre_completo, pa.nombre || ' ' || pa.apellido) AS nombre_completo,
                c.puesto_requerido,
                p.fecha_postulacion,
                p.resultado
            FROM postulaciones p
            INNER JOIN convocatorias c ON p.id_convocatoria = c.id_convocatoria
            LEFT JOIN usuarios u ON p.num_control = u.num_control
            LEFT JOIN personal_apoyo pa ON p.num_control = pa.matricula
            WHERE c.id_nombramiento = $1
            ORDER BY p.fecha_postulacion ASC
        `, [id_nombramiento]);

        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener los postulados del nombramiento:", err);
        res.status(500).json({ error: 'Error interno en el servidor: ' + err.message });
    }
});
// ========================================================
// RUTA PARA ELIMINAR UN TRABAJADOR (BORRADO LÓGICO)
// ========================================================
app.delete('/api/trabajadores/:num_control', async (req, res) => {
    const { num_control } = req.params;
    try {
        const result = await pool.query(
            "UPDATE usuarios SET estatus = 'Dado de baja' WHERE num_control = $1",
            [num_control]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Trabajador no encontrado.' });
        }

        res.json({ mensaje: 'Trabajador dado de baja correctamente (Borrado lógico).' });
    } catch (err) {
        console.error("Error al dar de baja:", err);
        res.status(500).json({ error: 'Error al dar de baja: ' + err.message });
    }
});

// ========================================================
// 9. ELIMINAR UN NOMBRAMIENTO Y SUS DEPENDENCIAS (OPCIÓN B)
// ========================================================
app.delete('/api/nombramientos/:id', async (req, res) => {
    const { id } = req.params;

    if (!id || id === 'undefined' || isNaN(id)) {
        return res.status(400).json({
            error: `El ID del nombramiento recibido no es valido (${id}).`
        });
    }
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Eliminar Postulaciones ligadas a las Convocatorias de este Nombramiento
        await client.query(`
            DELETE FROM postulaciones 
            WHERE id_convocatoria IN (
                SELECT id_convocatoria FROM convocatorias WHERE id_nombramiento = $1
            )
        `, [id]);

        // 2. Eliminar Convocatorias ligadas a este Nombramiento
        await client.query(
            'DELETE FROM convocatorias WHERE id_nombramiento = $1',
            [id]
        );

        // 3. Eliminar el Nombramiento definitivo
        await client.query(
            'DELETE FROM nombramientos WHERE id_nombramiento = $1',
            [id]
        );

        await client.query('COMMIT');
        return res.json({ message: "Nombramiento y dependencias eliminados con exito." });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR CRITICO EN EL DELETE DE POSTGRESQL:", error);
        return res.status(500).json({
            error: "Error en Base de Datos: " + error.message
        });
    } finally {
        client.release();
    }
});

// 10. CAMBIAR EL ESTADO DEL NOMBRAMIENTO (HACER LLAMADO)
app.put('/api/nombramientos/:id/llamado', async (req, res) => {
    const { id } = req.params;
    try {

        // Adaptado a pool.query con arreglos de parámetros planos ($1)
        await pool.query(
            "UPDATE nombramientos SET estado = 'Cerrada' WHERE id_nombramiento = $1",
            [id]
        );

        res.json({ message: "Llamado iniciado. Convocatoria cerrada." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al procesar el llamado" });
    }
});

// ========================================================
// RUTA PARA AMPLIAR EL TIEMPO DE LA CONVOCATORIA (VARIABLE)
// ========================================================
app.put('/api/nombramientos/:id/ampliar', async (req, res) => {
    const { id } = req.params;
    const { minutos } = req.body;

    if (!minutos || isNaN(minutos)) {
        return res.status(400).json({ error: 'Debes enviar una cantidad de minutos válida.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Sumar el tiempo a la fecha de cierre y asegurar que vuelva a estar 'Abierta'
        await client.query(`
            UPDATE nombramientos 
            SET fecha_cierre = fecha_cierre + ($1 || ' minutes')::interval,
                estado = 'Abierta'
            WHERE id_nombramiento = $2
        `, [minutos, id]);

        // Reactivar las convocatorias hijas
        await client.query(`
            UPDATE convocatorias
            SET estatus = 'Abierta'
            WHERE id_nombramiento = $1
        `, [id]);

        await client.query('COMMIT');
        res.json({ mensaje: `Convocatoria ampliada exitosamente por ${minutos} minutos.` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Error al ampliar convocatoria:", err);
        res.status(500).json({ error: 'Error en la Base de Datos al ampliar el tiempo.' });
    } finally {
        client.release();
    }
});

// ========================================================
// RUTA PARA ASIGNAR A UN TRABAJADOR (CONFIRMAR ASISTENCIA)
// ========================================================
app.put('/api/postulaciones/asignar', async (req, res) => {
    const { id_nombramiento, num_control, puesto } = req.body;

    try {
        await pool.query(`
            UPDATE postulaciones p
            SET resultado = 'Asignado'
            FROM convocatorias c
            WHERE p.id_convocatoria = c.id_convocatoria
            AND c.id_nombramiento = $1
            AND p.num_control = $2
            AND c.puesto_requerido = $3
        `, [id_nombramiento, num_control, puesto]);

        res.json({ mensaje: 'Trabajador marcado como Asignado correctamente.' });
    } catch (err) {
        console.error("Error al asignar:", err);
        res.status(500).json({ error: 'Error en la base de datos al asignar vacante.' });
    }
});

// ========================================================
// RUTA PARA APLICAR BRINCO (MARCAR COMO AUSENTE)
// ========================================================
app.put('/api/postulaciones/ausente', async (req, res) => {
    const { id_nombramiento, num_control } = req.body;

    try {
        await pool.query(`
            UPDATE postulaciones p
            SET resultado = 'Ausente'
            FROM convocatorias c
            WHERE p.id_convocatoria = c.id_convocatoria
            AND c.id_nombramiento = $1
            AND p.num_control = $2
        `, [id_nombramiento, num_control]);

        res.json({ mensaje: 'Trabajador marcado como Ausente (Brinco).' });
    } catch (err) {
        console.error("Error al aplicar brinco:", err);
        res.status(500).json({ error: 'Error en la base de datos al aplicar el brinco.' });
    }
});

app.get('/api/hora-servidor', (req, res) => {
    res.json({ hora_servidor: new Date().toISOString() });
});

app.get('/api/destinos', async (req, res) => {
    try {
        // Consultamos directamente la tabla que vimos en tu captura
        const result = await pool.query('SELECT nombre_destino FROM destino');
        res.json(result.rows);
    } catch (err) {
        console.error("Error en destinos:", err);
        res.status(500).json({ error: 'Error al traer los destinos' });
    }
});

// LEVANTAMIENTO DEL SERVIDOR
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo con exito en el puerto ${PORT}`);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

app.get('/api/trabajadores/no-postulados/:id_nombramiento', async (req, res) => {

    const { id_nombramiento } = req.params;

    try {

        const result = await pool.query(`
            SELECT
                u.num_control,
                u.nombre_completo,
                u.cursos
            FROM usuarios u
            WHERE u.rol = 'Trabajador'
            AND u.estatus = 'Apto'
            AND u.num_control NOT IN (

                SELECT p.num_control
                FROM postulaciones p
                INNER JOIN convocatorias c
                ON p.id_convocatoria = c.id_convocatoria
                WHERE c.id_nombramiento = $1
            )
        `, [id_nombramiento]);

        res.json(result.rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Error obteniendo trabajadores'
        });
    }
});

// GUARDAR CAMBIO DE NOMBRAMIENTO (POSTGRESQL)
app.put('/api/nombramientos/:id', async (req, res) => {

    const { id } = req.params;

    const {
        barco,
        muelle,
        turno,
        fecha_carga,
        fecha_cierre,
        vacantes
    } = req.body;

    const client = await pool.connect();

    try {

        await client.query('BEGIN');
        // 1. ACTUALIZAR DATOS PRINCIPALES

        await client.query(`
            UPDATE nombramientos
            SET
                barco = $1,
                muelle = $2,
                turno = $3,
                fecha_carga = $4,
                fecha_cierre = $5
            WHERE id_nombramiento = $6
        `, [
            barco,
            muelle,
            turno,
            fecha_carga,
            fecha_cierre,
            id
        ]);

        // 2. ELIMINAR VACANTES ANTERIORES

        await client.query(`
            DELETE FROM detalle_nombramiento
            WHERE id_nombramiento = $1
        `, [id]);

        // 3. INSERTAR NUEVAS VACANTES

        for (let v of vacantes) {

            await client.query(`
                INSERT INTO detalle_nombramiento
                (
                    id_nombramiento,
                    puesto,
                    cantidad
                )
                VALUES ($1, $2, $3)
            `, [
                id,
                v.puesto,
                v.cantidad
            ]);

        }

        await client.query('COMMIT');

        res.json({
            mensaje: 'Nombramiento actualizado con éxito'
        });

    } catch (err) {

        await client.query('ROLLBACK');

        console.error('Error actualizando nombramiento:', err);

        res.status(500).json({
            error: 'Error al actualizar en PostgreSQL: ' + err.message
        });

    } finally {

        client.release();

    }

});

app.get('/api/especialidades', async (req, res) => {
    try {

        const result = await pool.query(`
            SELECT *
            FROM especialidades
            WHERE activo = true
            ORDER BY nombre
        `);

        res.json(result.rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Error obteniendo especialidades'
        });

    }
});

app.post('/api/especialidades', async (req, res) => {

    const { nombre } = req.body;

    try {

        const result = await pool.query(`
            INSERT INTO especialidades(nombre)
            VALUES($1)
            RETURNING *
        `,[nombre]);

        res.json(result.rows[0]);

    } catch(err){

        res.status(500).json({
            error: err.message
        });

    }
});

app.delete('/api/especialidades/:id', async (req, res) => {

    try {

        await pool.query(`
            UPDATE especialidades
            SET activo = false
            WHERE id_especialidad = $1
        `, [req.params.id]);

        res.json({
            mensaje: 'Especialidad eliminada'
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.message
        });

    }
});
