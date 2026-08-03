import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('event_cursors')
export class EventCursorEntity {
  @PrimaryColumn({ type: 'varchar' })
  name: string;

  @Column({ name: 'last_block', type: 'bigint' })
  lastBlock: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
