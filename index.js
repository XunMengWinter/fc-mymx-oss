const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

const mysql = require('mysql2/promise');
const config = require('./config');

const app = express();
const OSS = require('ali-oss');

const moment = require("moment");
const { STS } = require("ali-oss");

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(bodyParser.raw());

const port = 9000

// Create a connection pool
const pool = mysql.createPool({
  host: config.host,
  user: config.user,
  password: config.password,
  database: config.database
});

const ossClient = new OSS({
  region: config.ossCofig.region,
  accessKeyId: config.ossCofig.accessKeyId,
  accessKeySecret: config.ossCofig.accessKeySecret,
  // 填写Bucket名称。
  bucket: config.ossCofig.bucket
});

function getUserId(req) {
  const auth = req.headers.authentication
  const token = auth.split(' ')[1];
  const { userId } = jwt.verify(token, config.jwtPublicKey);
  return userId;
}

async function deleteObject(fileUrl) {
  try {
    const filePath = fileUrl.split(".aliyuncs.com/").pop()
    // 填写Object完整路径。Object完整路径中不能包含Bucket名称。
    const result = await ossClient.delete(filePath);
    console.log(result);
    return result
  } catch (error) {
    console.log(error);
  }
}

async function getToken(dir, maxSize) {
  const { accessKeyId, accessKeySecret, roleArn, bucket, region } = config.stsConfig;
  const seconds = 3000; //过期时间为3000秒。
  const date = new Date();
  date.setSeconds(date.getSeconds() + seconds);
  const policy = {
    expiration: date.toISOString(), // 请求有效期。
    conditions: [
      ["content-length-range", 0, maxSize], // 设置上传文件的大小限制。
      ["starts-with", "$key", dir], // 限制文件只能上传到user-dirs目录下。
      { bucket }, // 限制文件只能上传至指定Bucket。
    ],
  };
  /* 使用stsToken的方式上传。*/
  let stsToken;
  let client;
  if (roleArn) {
    let sts = new STS({
      accessKeyId,
      accessKeySecret,
    });
    const {
      credentials: { AccessKeyId, AccessKeySecret, SecurityToken },
    } = await sts.assumeRole(roleArn, "", seconds, "sessiontest");
    stsToken = SecurityToken;
    client = new OSS({
      accessKeyId: AccessKeyId,
      accessKeySecret: AccessKeySecret,
      stsToken,
    });
  }

  // 计算签名。
  const formData = await client.calculatePostSignature(policy);

  // 返回参数。
  const params = {
    expire: moment(date).unix().toString(),
    policy: formData.policy,
    signature: formData.Signature,
    accessid: formData.OSSAccessKeyId,
    stsToken,
    host: `https://${bucket}.${region}.aliyuncs.com`,
    dir,
  };

  return params;
};

app.get('/sts/stsPetAvatar', async (req, res) => {
  const userId = getUserId(req);
  console.log('/stsPetAvatar', userId);
  const sts = await getToken(`pet-avatar/${userId}/`, 1024 * 1024 * 1);
  console.log(sts);
  res.send({
    sts: sts
  })
})

app.get('/sts/stsPetNote', async (req, res) => {
  const userId = getUserId(req);
  console.log('/stsPetNote', userId);
  const sts = await getToken(`pet-note/${userId}/`, 1024 * 1024 * 2);
  console.log(sts);
  res.send({
    sts: sts
  })
})

app.get('/api/getPetList', async (req, res) => {
  try {
    const userId = getUserId(req);
    console.log('/getPetList', userId)
    const [rows] = await pool.query(
      'SELECT * FROM pet WHERE ownerId = ?',
      [userId]
    );
    console.log(rows.length)
    res.send({
      data: rows,
    })
  } catch (error) {
    console.log(error)
    res.send({
      data: [],
    })
  }
})

app.get('/api/getNoteList', async (req, res) => {
  try {
    const userId = getUserId(req);
    console.log('/getNoteList', userId)
    const [rows] = await pool.query(
      'SELECT * FROM note WHERE ownerId = ? ORDER BY noteTime DESC',
      [userId],
    );
    console.log(rows)
    res.send({
      data: rows,
    })
  } catch (error) {
    console.log(error)
    res.send({
      data: [],
    })
  }
})

app.post('/api/addPet', async (req, res) => {
  const pet = req.body.pet
  console.log('/addPet', pet)
  const userId = getUserId(req);
  let petData = {
    ownerId: userId,
    name: pet.name,
    family: pet.family,
    gender: pet.gender,
    birthTime: pet.birthTime,
    avatar: pet.avatar,
    description: pet.description,
    createTime: parseInt(new Date().getTime() / 1000),
  }
  const insertResult = await addToDatabase("pet", petData)
  if (insertResult && insertResult.insertId) {
    petData.id = insertResult.insertId
    return res.send({
      data: petData
    })
  }
  res.send({
    
  })
})

app.post('/api/updatePet', async (req, res) => {
  const pet = req.body.pet
  if(!pet || !pet.id){
    res.send({
      error: "更新失败，请传入正确的ID。"
    })
    return
  }
  console.log('/updatePet', pet)
  const userId = getUserId(req);
  let petData = {
    ownerId: userId,
    name: pet.name,
    family: pet.family,
    gender: pet.gender,
    birthTime: pet.birthTime,
    avatar: pet.avatar,
    description: pet.description,
    updateTime: parseInt(new Date().getTime() / 1000),
  }
  const updateResult = await updateDatabase("pet", pet.id, petData)
  if (updateResult && updateResult.affectedRows) {
    petData.id = pet.id
    res.send({
      data: petData
    })
    return
  }
  res.send({
    error: "更新失败，请传入正确的参数。"
  })
})

app.post('/api/addNote', async (req, res) => {
  const note = req.body.note
  console.log('/addNote', note)
  const userId = getUserId(req);
  let noteData = {
    ownerId: userId,
    content: note.content,
    type: note.type,
    images: JSON.stringify(note.images),
    pets: JSON.stringify(note.pets),
    noteTime: note.noteTime,
    createTime: parseInt(new Date().getTime() / 1000),
  }
  const insertResult = await addToDatabase("note", noteData)
  if (insertResult && insertResult.insertId) {
    noteData.id = insertResult.insertId
    noteData.images = JSON.parse(noteData.images)
    noteData.pets = JSON.parse(noteData.pets)
    return res.send({
      data: noteData
    })
  }
  return res.send({})
})

app.post('/api/deleteNote', async (req, res) => {
  const noteId = req.body.noteId
  console.log('/deleteNote', noteId)
  const userId = getUserId(req);
  if (noteId && userId) {
    const [noteResult] = await pool.query(
      'SELECT * FROM note WHERE id = ? AND ownerId = ?',
      [noteId, userId]
    );
    console.log(noteResult)
    if (noteResult && noteResult.length > 0) {
      const images = noteResult[0].images
      for (let i = 0; i < images.length; i++) {
        const imageUrl = images[i]
        deleteObject(imageUrl)
        // const deleteRes = await deleteObject(imageUrl)
        // if(deleteRes && deleteRes.res.status == 204){
        //   console.log("delete image succeed: " + imageUrl)
        // }
      }
    }

    const [deleteResult] = await pool.query(
      'DELETE FROM note WHERE id = ? AND ownerId = ?',
      [noteId, userId]
    );

    if (deleteResult && deleteResult.affectedRows > 0) {
      res.send({
        data: true
      })
      return
    }
  }

  res.send({
    data: { error: "delete note failed" }
  })
})

app.post('/api/deletePet', async (req, res) => {
  const petId = req.body.petId
  console.log('/deletePet', petId)
  const userId = getUserId(req);
  if (petId && userId) {
    const [deleteResult] = await pool.query(
      `UPDATE pet SET lastOwnerId = ?, ownerId = ? WHERE id = ? AND ownerId = ?`,
      [userId, 0, petId, userId]
    );

    if (deleteResult && deleteResult.affectedRows > 0) {
      res.send({
        data: true
      })
      return
    }
  }

  res.send({
    data: { error: "delete pet failed" }
  })
})


// Function to check if user exists by phone number and insert if not
async function addToDatabase(table, data) {
  try {
    const [insertResult] = await pool.query(
      `INSERT INTO ${table} SET ?`,
      data
    );
    console.log(`New ${table} inserted successfully:`, insertResult);
    return insertResult
  } catch (error) {
    console.error(data)
    console.error(`Error querying/inserting into ${table}:`, error);
    throw error;
  }
}

// Function to check if user exists by phone number and insert if not
async function updateDatabase(table, id, data) {
  try {
    const [updateResult] = await pool.query(
      `UPDATE ${table} SET ? WHERE id = ? AND ownerId = ?`,
      [data, id, data.ownerId]
    );
    console.log(`Updated ${table} successfully:`, updateResult);
    return updateResult
  } catch (error) {
    console.error(data)
    console.error(`Error querying/updating ${table}:`, error);
    throw error;
  }
}

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})