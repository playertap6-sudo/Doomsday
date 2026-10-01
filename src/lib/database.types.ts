export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      captions: {
        Row: {
          chunk_index: number;
          created_at: string;
          id: string;
          language: string;
          lecture_id: string;
          text: string;
        };
        Insert: {
          chunk_index?: number;
          created_at?: string;
          id?: string;
          language: string;
          lecture_id: string;
          text: string;
        };
        Update: {
          chunk_index?: number;
          created_at?: string;
          id?: string;
          language?: string;
          lecture_id?: string;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "captions_lecture_id_fkey";
            columns: ["lecture_id"];
            isOneToOne: false;
            referencedRelation: "lectures";
            referencedColumns: ["id"];
          },
        ];
      };
      lecture_students: {
        Row: {
          id: string;
          joined_at: string;
          language: string;
          lecture_id: string;
          student_id: string;
        };
        Insert: {
          id?: string;
          joined_at?: string;
          language?: string;
          lecture_id: string;
          student_id: string;
        };
        Update: {
          id?: string;
          joined_at?: string;
          language?: string;
          lecture_id?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lecture_students_lecture_id_fkey";
            columns: ["lecture_id"];
            isOneToOne: false;
            referencedRelation: "lectures";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lecture_students_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      lectures: {
        Row: {
          created_at: string;
          ended_at: string | null;
          id: string;
          join_code: string;
          started_at: string | null;
          status: string;
          teacher_id: string;
          title: string;
        };
        Insert: {
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          join_code: string;
          started_at?: string | null;
          status?: string;
          teacher_id: string;
          title: string;
        };
        Update: {
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          join_code?: string;
          started_at?: string | null;
          status?: string;
          teacher_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lectures_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notes: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          language: string;
          lecture_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          language: string;
          lecture_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          language?: string;
          lecture_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notes_lecture_id_fkey";
            columns: ["lecture_id"];
            isOneToOne: false;
            referencedRelation: "lectures";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          id: string;
          language: string;
          name: string;
          role: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          language?: string;
          name: string;
          role: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          language?: string;
          name?: string;
          role?: string;
        };
        Relationships: [];
      };
      quiz_attempts: {
        Row: {
          answers: Json;
          id: string;
          quiz_id: string;
          score: number;
          student_id: string;
          submitted_at: string;
          total: number;
          weak_topics: string[] | null;
        };
        Insert: {
          answers?: Json;
          id?: string;
          quiz_id: string;
          score?: number;
          student_id: string;
          submitted_at?: string;
          total?: number;
          weak_topics?: string[] | null;
        };
        Update: {
          answers?: Json;
          id?: string;
          quiz_id?: string;
          score?: number;
          student_id?: string;
          submitted_at?: string;
          total?: number;
          weak_topics?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_quiz_id_fkey";
            columns: ["quiz_id"];
            isOneToOne: false;
            referencedRelation: "quizzes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quiz_attempts_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      quizzes: {
        Row: {
          created_at: string;
          id: string;
          language: string;
          lecture_id: string;
          questions: Json;
        };
        Insert: {
          created_at?: string;
          id?: string;
          language?: string;
          lecture_id: string;
          questions?: Json;
        };
        Update: {
          created_at?: string;
          id?: string;
          language?: string;
          lecture_id?: string;
          questions?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "quizzes_lecture_id_fkey";
            columns: ["lecture_id"];
            isOneToOne: false;
            referencedRelation: "lectures";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      generate_join_code: { Args: never; Returns: string };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
