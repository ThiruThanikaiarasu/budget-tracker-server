import mongoose, { Schema, Document } from "mongoose";

export interface IPricePoint {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface IFundamentals {
  marketCap?: number; // in ₹ crore
  pe?: number;
  pb?: number;
  bookValue?: number;
  eps?: number;
  roe?: number; // %
  roce?: number; // %
  dividendYield?: number; // %
  faceValue?: number;
  high52?: number;
  low52?: number;
  debtToEquity?: number;
  industry?: string;
}

export interface IStockAnalysis extends Document {
  symbol: string;
  exchange: "NSE" | "BSE";
  name: string;
  currentPrice?: number;
  fundamentals: IFundamentals;
  priceSeries: IPricePoint[];
  source?: string;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const fundamentalsSchema = new Schema<IFundamentals>(
  {
    marketCap: Number,
    pe: Number,
    pb: Number,
    bookValue: Number,
    eps: Number,
    roe: Number,
    roce: Number,
    dividendYield: Number,
    faceValue: Number,
    high52: Number,
    low52: Number,
    debtToEquity: Number,
    industry: String,
  },
  { _id: false }
);

const pricePointSchema = new Schema<IPricePoint>(
  {
    date: { type: String, required: true },
    close: { type: Number, required: true },
  },
  { _id: false }
);

const stockAnalysisSchema = new Schema<IStockAnalysis>(
  {
    symbol: { type: String, required: true, uppercase: true, trim: true },
    exchange: { type: String, enum: ["NSE", "BSE"], default: "NSE" },
    name: { type: String, required: true, trim: true },
    currentPrice: { type: Number },
    fundamentals: { type: fundamentalsSchema, default: {} },
    priceSeries: { type: [pricePointSchema], default: [] },
    source: { type: String },
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Market data is the same for everyone — cache one document per (symbol, exchange).
stockAnalysisSchema.index({ symbol: 1, exchange: 1 }, { unique: true });

export const StockAnalysis = mongoose.model<IStockAnalysis>(
  "StockAnalysis",
  stockAnalysisSchema
);
