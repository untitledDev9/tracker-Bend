const { Schema, model } = require("mongoose");

const stopSchema = new Schema({
  id:       { type: String, required: true },
  label:    { type: String, default: "" },
  location: { type: String, default: "" },
  city:     { type: String, default: "" },
  state:    { type: String, default: "" },
  zip:      { type: String, default: "" },
  country:  { type: String, default: "" },
  date:     { type: String, default: "" },
  time:     { type: String, default: "" },
  status:   { type: String, enum: ["pending", "active", "done"], default: "pending" },
}, { _id: false });

const packageSchema = new Schema({
  id:                { type: String, required: true, unique: true, uppercase: true },
  description:       { type: String, default: "" },
  weight:            { type: String, default: "" },
  sender:            { type: String, default: "" },
  recipient:         { type: String, default: "" },
  transport:         { type: String, default: "truck" },
  status:            { type: String, default: "in_transit" },
  estimatedDelivery: { type: String, default: "" },
  stops:             [stopSchema],
}, { timestamps: true });

/* Return plain object shaped like the frontend expects */
packageSchema.methods.toClient = function () {
  const obj = this.toObject();
  delete obj._id;
  delete obj.__v;
  delete obj.createdAt;
  delete obj.updatedAt;
  return obj;
};

module.exports = model("Package", packageSchema);
