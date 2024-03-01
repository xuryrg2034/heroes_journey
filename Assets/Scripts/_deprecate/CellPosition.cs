public class CellPosition
{
    public int Row { get; private set; }
    public int Column { get; private set; }

    public CellPosition(int column, int row)
    {
        Row = row;
        Column = column;
    }
}