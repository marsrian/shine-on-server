const express = require("express");
const cors = require("cors");
const SSLCommerzPayment = require("sslcommerz-lts");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }
  // bearer token
  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qabixji.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// SSL Commerz Payment:
const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASS;
const is_live = false; //true for live, false for sandbox

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const usersCollection = client.db("shine-on").collection("users");
    const jewelryCollection = client.db("shine-on").collection("jewelry");
    const addCartCollection = client.db("shine-on").collection("addCart");
    const orderCollection = client.db("shine-on").collection("order");

    // JWT Token:
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });

      res.send({ token });
    });

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden message" });
      }
      next();
    };

    // users related apis:
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Admin:
    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    // Client:
    app.get("/users/client/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ client: false });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { client: user?.role === "client" };
      res.send(result);
    });

    // get all client:
    app.get("/allUsers/:role", async (req, res) => {
      const roles = await usersCollection
        .find({
          role: req.params.role,
        })
        .toArray();
      res.send(roles);
    });

    // Admin role set to Admin:
    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };

      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Jewelry Post:
    app.post("/jewelry", async (req, res) => {
      const newJewelry = req.body;
      const result = await jewelryCollection.insertOne(newJewelry);
      res.send(result);
    });

    // Get Jewelry All Data:
    app.get("/jewelryAll", async (req, res) => {
      const result = await jewelryCollection.find().toArray();
      res.send(result);
    });

    // Get Jewelry Single Data:
    app.get("/jewelryAll/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jewelryCollection.findOne(query);
      res.send(result);
    });

    // ------------------------Add To Cart----------------------:
    // user added jewelry to AddToCart List:
    app.post("/cart", async (req, res) => {
      const item = req.body;
      console.log(item);
      const result = await addCartCollection.insertOne(item);
      res.send(result);
    });

    // user get jewelry data from cart:
    app.get("/cart", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }

      const query = { email: email };
      const result = await addCartCollection.find(query).toArray();
      res.send(result);
    });

    // user get selected Jewelry data from cart:
    app.get("/cart/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await addCartCollection.findOne(query);
      res.send(result);
    });

    // user delete selected jewelry data from cart:
    app.delete("/cart/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await addCartCollection.deleteOne(query);
      res.send(result);
    });

    const tran_id = new ObjectId().toString();

    // SSl Commerz payment Order:
    app.post("/order", async (req, res) => {
      const product = await jewelryCollection.findOne({
        _id: new ObjectId(req.body.productId),
      });
      const order = req.body;
      const data = {
        total_amount: product?.price,
        currency: order.currency,
        tran_id: tran_id, // use unique tran_id for each api call
        success_url: `https://shine-on-2023.web.app/payment/success/${tran_id}`,
        fail_url: `https://shine-on-2023.web.app/payment/fail/${tran_id}`,
        cancel_url: "https://shine-on-2023.web.app/cancel",
        ipn_url: "http://localhost:3030/ipn",
        shipping_method: "Courier",
        product_name: "Computer.",
        product_category: "Electronic",
        product_profile: "general",
        cus_name: order.name,
        cus_email: "customer@example.com",
        cus_add1: "Dhaka",
        cus_add2: "Dhaka",
        cus_city: "Dhaka",
        cus_state: "Dhaka",
        cus_postcode: "1000",
        cus_country: "Bangladesh",
        cus_phone: "01711111111",
        cus_fax: "01711111111",
        ship_name: "Customer Name",
        ship_add1: "Dhaka",
        ship_add2: "Dhaka",
        ship_city: "Dhaka",
        ship_state: "Dhaka",
        ship_postcode: 1000,
        ship_country: "Bangladesh",
      };
      console.log(data);
      const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
      sslcz.init(data).then((apiResponse) => {
        // Redirect the user to payment gateway
        let GatewayPageURL = apiResponse.GatewayPageURL;
        res.send({ url: GatewayPageURL });

        const finalOrder = {
          product,
          paidStatus: false,
          transactionId: tran_id,
        };
        const result = orderCollection.insertOne(finalOrder);

        console.log("Redirecting to: ", GatewayPageURL);
      });

      app.post("/payment/success/:tranId", async (req, res) => {
        console.log(req.params.tranId);
        const result = await orderCollection.updateOne(
          {transactionId: req.params.tranId},
          {
            $set: {
              paidStatus: true,
            }
          }
        );
        if(result.modifiedCount>0){
          res.redirect(`https://shine-on-2023.web.app/payment/success/${req.params.tranId}`)
        };
      });

      app.post("/payment/fail/:tranId", async(req, res) =>{
        const result = await orderCollection.deleteOne({transactionId: req.params.tranId});
        if(result.deletedCount>0){
          res.redirect(`https://shine-on-2023.web.app/payment/fail/${req.params.tranId}`)
        }
      })

    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Shine On is Running");
});

app.listen(port, () => {
  console.log(`Shine On is Running on port ${port}`);
});
