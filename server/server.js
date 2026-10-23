
// Import modules
const express = require("express");
const dotenv = require("dotenv").config();
const path = require("path");

// Create express app and requirements
const app = express();
app.use(express.static("client"));

// Get environment variables
SERVER_PORT = process.env.SERVER_PORT

// Open the server
app.listen(SERVER_PORT, function(){
    console.log(`Running server on: localhost:${SERVER_PORT}`)
})