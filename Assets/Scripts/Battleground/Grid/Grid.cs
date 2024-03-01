using System;
using System.Collections.Generic;
using UnityEngine;

public class Grid
{
    public int[,] Template { get; private set; }
    private GridController _controller;
    private GridView _view;
    public Grid(int[,] template, GridView view)
    {
        Template = template;
        _view = view;
        
    }

    public void Initialize()
    {
        _view.InitializeBoard(Template);
    }
}