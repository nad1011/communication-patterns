import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  productId: string;

  @Column({ nullable: true })
  customerId: string;

  @Column()
  quantity: number;

  @Column()
  status: string; // pending, payment_pending, paid, payment_failed, completed

  @Column({ nullable: true })
  paymentId: string;

  @Column({ nullable: true })
  paymentStatus: string;

  @Column({ nullable: true })
  paymentError: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
