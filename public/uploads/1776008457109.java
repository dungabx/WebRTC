package Part7_javaSocketProgramming;

import java.awt.EventQueue;

import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextField;


import javax.swing.JButton;
import java.awt.Font;
import javax.swing.JTextArea;
import java.awt.event.ActionListener;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.Socket;
import java.awt.event.ActionEvent;
import javax.swing.SwingConstants;
import javax.swing.border.EmptyBorder;

public class TCPClientFrame extends JFrame implements Runnable {
	private JTextField txtPort;
	private JTextField txtMessage;
	private JLabel lblChattingHistory;
	private JTextArea chattingHistory;
	Socket socket;
	DataOutputStream dataOutputStream;
	DataInputStream dataInputStream;
	
	private JTextField serverName;

	/**
	 * Launch the application.
	 */
	public static void main(String[] args) {
		EventQueue.invokeLater(new Runnable() {
			public void run() {
				try {
					TCPClientFrame frame = new TCPClientFrame();
					frame.setVisible(true);
				} catch (Exception e) {
					e.printStackTrace();
				}
			}
		});
	}

	/**
	 * Create the frame.
	 */
	public TCPClientFrame() {
		setTitle("CLIENT");
		setFont(new Font("Times New Roman", Font.BOLD, 18));
		setBounds(100, 100, 467, 300);
		setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
		getContentPane().setLayout(null);
		JPanel contentPane = new JPanel();
		contentPane.setBorder(new EmptyBorder(5, 5, 5, 5));
		setContentPane(contentPane);
		contentPane.setLayout(null);
		
		JLabel lblNewLabel = new JLabel("Port No:");
		lblNewLabel.setFont(new Font("Times New Roman", Font.BOLD, 16));
		lblNewLabel.setBounds(229, 11, 66, 25);
		getContentPane().add(lblNewLabel);
		
		txtPort = new JTextField();
		txtPort.setText("2026");
		txtPort.setFont(new Font("Times New Roman", Font.PLAIN, 16));
		txtPort.setBounds(294, 9, 56, 28);
		getContentPane().add(txtPort);
		txtPort.setColumns(10);
		
		chattingHistory = new JTextArea();
		chattingHistory.setBounds(39, 71, 387, 140);
		getContentPane().add(chattingHistory);
		// JScrollPane scrollPane = new JScrollPane(chattingHistory);
		// scrollPane.setBounds(39, 71, 387, 140);
	    // contentPane.add(scrollPane);
		
		
		txtMessage = new JTextField();
		txtMessage.setFont(new Font("Times New Roman", Font.PLAIN, 14));
		txtMessage.setColumns(10);
		txtMessage.setBounds(39, 221, 311, 32);
		getContentPane().add(txtMessage);
		
		JButton btnStart = new JButton("Start");
		btnStart.addActionListener(new ActionListener() {
			public void actionPerformed(ActionEvent e) {
				//chattingHistory.setText("Client is connecting");
				try {
					socket = new Socket(serverName.getText(),Integer.parseInt(txtPort.getText().trim()));
					Thread thread = new Thread(TCPClientFrame.this);
					thread.start();
				} catch (NumberFormatException | IOException e1) {
					// TODO Auto-generated catch block
					e1.printStackTrace();
				} 
			}
		});
		btnStart.setFont(new Font("Times New Roman", Font.BOLD, 12));
		btnStart.setBounds(345, 12, 81, 28);
		getContentPane().add(btnStart);
		
		JButton btnSend = new JButton("Send");
		btnSend.addActionListener(new ActionListener() {
			public void actionPerformed(ActionEvent e) {
				String str =txtMessage.getText();
				try {
					dataOutputStream = new DataOutputStream(socket.getOutputStream());
					dataOutputStream.writeUTF(str);
					dataOutputStream.flush();
					chattingHistory.setText(chattingHistory.getText()+"\n Me say: " + str);
					txtMessage.setText("");
				} catch (IOException e1) {
					// TODO Auto-generated catch block
					e1.printStackTrace();
				}
			}
		});
		btnSend.setFont(new Font("Times New Roman", Font.BOLD, 12));
		btnSend.setBounds(360, 221, 66, 32);
		getContentPane().add(btnSend);
		
		lblChattingHistory = new JLabel("Chatting History");
		lblChattingHistory.setEnabled(false);
		lblChattingHistory.setHorizontalAlignment(SwingConstants.CENTER);
		lblChattingHistory.setFont(new Font("Times New Roman", Font.BOLD, 16));
		lblChattingHistory.setBounds(91, 45, 259, 25);
		getContentPane().add(lblChattingHistory);
		
		serverName = new JTextField();
		serverName.setText("localhost");
		serverName.setFont(new Font("Times New Roman", Font.PLAIN, 16));
		serverName.setColumns(10);
		serverName.setBounds(118, 9, 90, 28);
		contentPane.add(serverName);
		
		JLabel lblNewLabel_1 = new JLabel("Server Name:");
		lblNewLabel_1.setFont(new Font("Times New Roman", Font.BOLD, 16));
		lblNewLabel_1.setBounds(20, 12, 100, 25);
		contentPane.add(lblNewLabel_1);

	}

	@Override
	public void run() {
		String str="";
		try {
			dataInputStream = new DataInputStream(socket.getInputStream());
			while(!str.equals("exit")) {
				str = dataInputStream.readUTF();
				chattingHistory.setText(chattingHistory.getText()+"\n Server say: " + str);
				Thread.sleep(1000);
			}
		} catch (IOException | InterruptedException e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		}
		finally{
			try{
				if(socket!=null){
					socket.close();
				}
			}
			catch(IOException e){}
		}
	}
}
