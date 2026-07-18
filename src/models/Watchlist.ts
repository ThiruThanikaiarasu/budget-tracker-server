import mongoose, { Schema, Document, Types } from "mongoose";

export type WatchlistExchange = "NSE" | "BSE";

export interface IWatchlistItem {
  symbol: string;
  exchange: WatchlistExchange;
  name: string;
  instrumentToken?: number;
  targetBuyPrice?: number;
  notes?: string;
  lastPrice?: number;
  lastPriceAt?: Date;
}

export interface IWatchlist extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  color?: string;
  order: number;
  items: Types.DocumentArray<IWatchlistItem>;
  createdAt: Date;
  updatedAt: Date;
}

// Items keep their own _id so they can be addressed individually via the API.
const watchlistItemSchema = new Schema<IWatchlistItem>({
  symbol: { type: String, required: true, uppercase: true, trim: true },
  exchange: { type: String, enum: ["NSE", "BSE"], required: true, default: "NSE" },
  name: { type: String, required: true, trim: true },
  instrumentToken: { type: Number },
  targetBuyPrice: { type: Number, min: 0 },
  notes: { type: String },
  lastPrice: { type: Number, min: 0 },
  lastPriceAt: { type: Date },
});

const watchlistSchema = new Schema<IWatchlist>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    color: { type: String },
    order: { type: Number, default: 0 },
    items: { type: [watchlistItemSchema], default: [] },
  },
  { timestamps: true }
);

export const Watchlist = mongoose.model<IWatchlist>("Watchlist", watchlistSchema);
