import mongoose, { Schema, Document } from "mongoose";

export interface IFriend extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  createdAt: Date;
}

const friendSchema = new Schema<IFriend>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

export const Friend = mongoose.model<IFriend>("Friend", friendSchema);
