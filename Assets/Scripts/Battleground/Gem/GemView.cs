using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class GemView : MonoBehaviour
{
    public int Column { get; private set; }
    public int Row { get; private set; }

    public void Initialze(int column, int row)
    {
        Column = column;
        Row = row;

        ChangePosition();
    }

    private void ChangePosition()
    {
        
    }
}
