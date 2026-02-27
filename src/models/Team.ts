import mongoose, { Document, Schema } from "mongoose";

export interface ITeamMember {
  user: mongoose.Types.ObjectId;
  role: "admin" | "editor" | "viewer";
}

export interface ITeam extends Document {
  name: string;
  owner: mongoose.Types.ObjectId;
  members: ITeamMember[];
  createdAt: Date;
  updatedAt: Date;
}

const teamSchema = new Schema<ITeam>(
  {
    name: {
      type: String,
      required: [true, "Team name is required"],
      trim: true,
      maxlength: 50,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: [
      {
        user: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        role: {
          type: String,
          enum: ["admin", "editor", "viewer"],
          default: "viewer",
        },
      },
    ],
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<ITeam>("Team", teamSchema);
