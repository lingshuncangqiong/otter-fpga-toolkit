// 中文前缀用于验证 UTF-8 字节偏移，不通过字符位置猜 CST 范围。
module no_markers;
localparam  integer              P_DW           =   8                     ;
localparam           [1     :0]  P_ST_IDLE      =   2'd0                  ;
localparam           [1     :0]  P_ST_WORK      =   2'd1                  ;

// 无任何星号分区，下面仍应共用声明头。
reg                  [1     :0]  r_st_current   =   P_ST_IDLE     ;
reg                  [1     :0]  r_st_next                        ;
wire                 [P_DW-1:0]  w_data        ;
localparam  integer              P_LONG         =   P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + P_DW + 1 ;
localparam  string               P_TEXT         =   "keep  two // spaces" ;
reg                  [3:0][7:0]  r_multi        =   '0            ;
reg                  [7     :0]  r_array [0:2]  =   '{default:'0} ;
genvar                           g_outer       ;// 独立 generate 变量应参与名称列对齐
genvar                           g_x, g_y      ;// 不拆分名称列表
wire w_a, w_b; // 保留多变量声明
localparam integer P_MULTILINE =
    P_DW + 1; // 保留多行声明
generate
    for (genvar i=0; i<2; i=i+1) begin : g
        genvar         g_inner ;
        reg     [2:0]  r_local  =   '0 ;
        wire           w_local ;
    end
endgenerate
endmodule
module second;
reg  r_small  =   1'b0 ;
endmodule
