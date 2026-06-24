const { Schema, model } = require("mongoose");
const bcrypt = require("bcryptjs");

const adminSchema = new Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
}, { timestamps: true });

adminSchema.pre("save", async function () {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 12);
  }
});

adminSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = model("Admin", adminSchema);
